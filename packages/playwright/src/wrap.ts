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

export function wrapLocator(locator: Locator, hooks: WrapHooks, meta: LocatorMeta): Locator {
  return new Proxy(locator, {
    get(target, prop) {
      if (prop === RAW_TARGET) return target;
      if (prop === LOCATOR_KEY) return meta.key;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const name = typeof prop === 'string' ? prop : '';

      if (LOCATOR_CHAIN_METHODS.has(name)) {
        return (...args: unknown[]) =>
          wrapLocator((value as (...a: unknown[]) => Locator).apply(target, unwrapArgs(args)), hooks, {
            key: chainKey(meta.key, serializeCall(name, args)),
            callsite: captureCallsite() ?? meta.callsite,
          });
      }

      if (LOCATOR_ACTION_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          try {
            const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(
              target,
              unwrapArgs(args),
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
      const name = typeof prop === 'string' ? prop : '';

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
