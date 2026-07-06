/**
 * Public-API Page/Locator proxy (validated in Spike B, design doc §9.2).
 * Invariants:
 * - Playwright methods are always invoked with the raw target as receiver.
 * - Locator factories/chains return re-wrapped locators carrying their
 *   canonical locatorKey and construction callsite.
 * - Action failures flow through the healing hook, which may return a
 *   replacement locator for a single retry.
 */

import type { Locator, Page } from '@playwright/test';
import type { Callsite } from '@relocator/core';
import { chainKey, serializeCall } from './keys.js';

export interface LocatorMeta {
  key: string;
  callsite: Callsite | undefined;
  /**
   * Chain of frameLocator selectors from the page down to this locator's
   * frame (§9.5). Empty/absent = main frame. Gives each frame its own
   * fingerprint space (the selectors are also baked into `key`) and tells
   * the engine which frame to capture/score in.
   */
  framePath?: string[];
}

export interface ActionFailure {
  method: string;
  args: unknown[];
  error: Error;
  meta: LocatorMeta;
}

export interface WrapHooks {
  onActionFailure?: (raw: Locator, failure: ActionFailure) => Promise<Locator | null>;
  onActionSuccess?: (raw: Locator, method: string, meta: LocatorMeta) => void;
  /**
   * Timeout split (design §9.2): cap the FIRST attempt at this many ms so
   * healing starts before the full action timeout elapses. Only applied
   * when the caller didn't pass an explicit timeout; the healed retry runs
   * with the caller's original options (full budget).
   */
  initialActionTimeoutMs?: number;
}

/** Methods whose first argument is a payload object, not an options bag. */
const PAYLOAD_FIRST_METHODS = new Set(['selectOption', 'setInputFiles']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Inject the split timeout into an action call. Every Playwright action
 * accepts a trailing options object; we merge when the last arg already is
 * one, and append otherwise. Explicit caller timeouts are always respected.
 */
export function withInitialTimeout(
  method: string,
  args: unknown[],
  timeoutMs: number,
): unknown[] {
  const last = args[args.length - 1];
  const lastIsOptions =
    isPlainObject(last) && (!PAYLOAD_FIRST_METHODS.has(method) || args.length >= 2);
  if (lastIsOptions) {
    if ('timeout' in last) return args;
    return [...args.slice(0, -1), { ...last, timeout: timeoutMs }];
  }
  return [...args, { timeout: timeoutMs }];
}

/**
 * 60% of the configured action timeout, floored at min(5s, T) so a slow but
 * valid locator is never healed prematurely (§9.2). 0 (Playwright's
 * "no action timeout") stays unsplit.
 */
export function computeInitialActionTimeout(configuredMs: number): number | undefined {
  if (!Number.isFinite(configuredMs) || configuredMs <= 0) return undefined;
  return Math.round(Math.max(Math.min(5_000, configuredMs), configuredMs * 0.6));
}

const PAGE_LOCATOR_FACTORIES = new Set([
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
]);

const LOCATOR_CHAIN_METHODS = new Set([
  ...PAGE_LOCATOR_FACTORIES,
  'filter',
  'first',
  'last',
  'nth',
  'and',
  'or',
]);

const LOCATOR_ACTION_METHODS = new Set([
  'click',
  'dblclick',
  'fill',
  'check',
  'uncheck',
  'selectOption',
  'hover',
  'press',
  'pressSequentially',
  'tap',
  'clear',
  'setInputFiles',
  'selectText',
  'dragTo',
]);

export const RAW_TARGET = Symbol('relocator.rawTarget');
const LOCATOR_KEY = '__relocatorKey';

/**
 * Properties that must be returned raw even though they are functions.
 * Playwright's expect() (< 1.60) brand-checks `receiver.constructor.name`;
 * wrapping `constructor` in a pass-through arrow gave it an empty name and
 * broke every web-first assertion on proxied locators/pages.
 */
const RAW_FUNCTION_PROPS = new Set(['constructor']);

export function unwrap<T>(value: T): T {
  const raw = (value as { [RAW_TARGET]?: T } | null | undefined)?.[RAW_TARGET];
  return raw ?? value;
}

function unwrapArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg !== null && typeof arg === 'object') {
      const direct = unwrap(arg);
      if (direct !== arg) return direct;
      const record = arg as Record<string, unknown>;
      let copied: Record<string, unknown> | null = null;
      for (const key of Object.keys(record)) {
        const value = record[key];
        const unwrapped = unwrap(value);
        if (unwrapped !== value) {
          copied ??= { ...record };
          copied[key] = unwrapped;
        }
      }
      return copied ?? arg;
    }
    return arg;
  });
}

export function captureCallsite(): Callsite | undefined {
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n').slice(1)) {
    if (line.includes('/wrap.ts') || line.includes('/wrap.js') || line.includes('node_modules')) {
      continue;
    }
    const match = /\(?([^()\s]+):(\d+):(\d+)\)?\s*$/.exec(line);
    if (match && !match[1]!.startsWith('node:')) {
      return { file: match[1]!, line: Number(match[2]), column: Number(match[3]) };
    }
  }
  return undefined;
}

/**
 * Wrap a FrameLocator (§9.5): its locator factories produce wrapped
 * locators whose keys are prefixed with the frame chain and whose meta
 * carries the framePath; nested frameLocator calls extend the chain.
 */
function wrapFrameLocator(
  frameLocator: object,
  hooks: WrapHooks,
  framePath: string[],
  keyPrefix: string,
): object {
  return new Proxy(frameLocator, {
    get(target, prop) {
      if (prop === RAW_TARGET) return target;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (RAW_FUNCTION_PROPS.has(typeof prop === 'string' ? prop : '')) return value;
      const name = typeof prop === 'string' ? prop : '';

      if (name === 'frameLocator') {
        return (...args: unknown[]) =>
          wrapFrameLocator(
            (value as (...a: unknown[]) => object).apply(target, unwrapArgs(args)),
            hooks,
            [...framePath, String(args[0])],
            chainKey(keyPrefix, serializeCall(name, args)),
          );
      }

      if (PAGE_LOCATOR_FACTORIES.has(name)) {
        return (...args: unknown[]) =>
          wrapLocator((value as (...a: unknown[]) => Locator).apply(target, unwrapArgs(args)), hooks, {
            key: chainKey(keyPrefix, serializeCall(name, args)),
            callsite: captureCallsite(),
            framePath,
          });
      }

      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, unwrapArgs(args));
    },
  });
}

export function wrapLocator(locator: Locator, hooks: WrapHooks, meta: LocatorMeta): Locator {
  return new Proxy(locator, {
    get(target, prop) {
      if (prop === RAW_TARGET) return target;
      if (prop === LOCATOR_KEY) return meta.key;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (RAW_FUNCTION_PROPS.has(typeof prop === 'string' ? prop : '')) return value;
      const name = typeof prop === 'string' ? prop : '';

      if (name === 'frameLocator') {
        return (...args: unknown[]) =>
          wrapFrameLocator(
            (value as (...a: unknown[]) => object).apply(target, unwrapArgs(args)),
            hooks,
            [...(meta.framePath ?? []), String(args[0])],
            chainKey(meta.key, serializeCall(name, args)),
          );
      }

      if (LOCATOR_CHAIN_METHODS.has(name)) {
        return (...args: unknown[]) =>
          wrapLocator((value as (...a: unknown[]) => Locator).apply(target, unwrapArgs(args)), hooks, {
            key: chainKey(meta.key, serializeCall(name, args)),
            callsite: captureCallsite() ?? meta.callsite,
            ...(meta.framePath ? { framePath: meta.framePath } : {}),
          });
      }

      if (LOCATOR_ACTION_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          const initialArgs =
            hooks.initialActionTimeoutMs !== undefined
              ? withInitialTimeout(name, args, hooks.initialActionTimeoutMs)
              : args;
          try {
            const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(
              target,
              unwrapArgs(initialArgs),
            );
            hooks.onActionSuccess?.(target, name, meta);
            return result;
          } catch (error) {
            if (hooks.onActionFailure) {
              const replacement = await hooks.onActionFailure(target, {
                method: name,
                args,
                error: error as Error,
                meta,
              });
              if (replacement) {
                const raw = unwrap(replacement);
                const retry = (raw as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
                  name
                ]!;
                return await retry.apply(raw, unwrapArgs(args));
              }
            }
            throw error;
          }
        };
      }

      return (...args: unknown[]) => value.apply(target, unwrapArgs(args));
    },
  });
}

export function wrapPage(page: Page, hooks: WrapHooks): Page {
  return new Proxy(page, {
    get(target, prop) {
      if (prop === RAW_TARGET) return target;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (RAW_FUNCTION_PROPS.has(typeof prop === 'string' ? prop : '')) return value;
      const name = typeof prop === 'string' ? prop : '';

      if (name === 'frameLocator') {
        return (...args: unknown[]) =>
          wrapFrameLocator(
            (value as (...a: unknown[]) => object).apply(target, unwrapArgs(args)),
            hooks,
            [String(args[0])],
            serializeCall(name, args),
          );
      }

      if (PAGE_LOCATOR_FACTORIES.has(name)) {
        return (...args: unknown[]) =>
          wrapLocator((value as (...a: unknown[]) => Locator).apply(target, unwrapArgs(args)), hooks, {
            key: chainKey(undefined, serializeCall(name, args)),
            callsite: captureCallsite(),
          });
      }

      return (...args: unknown[]) => value.apply(target, unwrapArgs(args));
    },
  });
}
