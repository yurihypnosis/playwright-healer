/**
 * Spike B: prototype of the public-API-only Locator/Page proxy wrapper.
 *
 * Design rules validated here:
 * - Methods are always invoked with the *raw target* as receiver, never the
 *   proxy, so Playwright-internal private state stays reachable.
 * - Locator factories and chain methods return re-wrapped locators, so the
 *   interception survives arbitrary chaining.
 * - Action methods are intercepted; on failure a healing hook may supply a
 *   replacement locator and the action is retried exactly once.
 * - The callsite of the original locator construction is captured from
 *   Error().stack at wrap time.
 */

import type { Locator, Page } from '@playwright/test';

export interface Callsite {
  file: string;
  line: number;
  column: number;
}

export interface ActionFailure {
  method: string;
  args: unknown[];
  error: Error;
  callsite: Callsite | undefined;
}

export interface WrapHooks {
  /** Called when an action fails; return a replacement locator to retry with, or null to rethrow. */
  onActionFailure?: (locator: Locator, failure: ActionFailure) => Promise<Locator | null>;
  /** Called after an action succeeds (fingerprint capture goes here later). */
  onActionSuccess?: (locator: Locator, method: string, callsite: Callsite | undefined) => void;
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
  'locator',
  'filter',
  'first',
  'last',
  'nth',
  'and',
  'or',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
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
  'focus',
  'dragTo',
]);

/** Symbol to retrieve the raw Locator behind a proxy (and detect proxies). */
export const RAW_TARGET = Symbol('relocator.rawTarget');

export function unwrap<T>(value: T): T {
  const raw = (value as { [RAW_TARGET]?: T } | null | undefined)?.[RAW_TARGET];
  return raw ?? value;
}

/** Unwrap proxied locators passed as arguments (e.g. filter({ has })). */
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
    if (line.includes('/src/wrap.ts') || line.includes('node_modules')) continue;
    const match = /\(?([^()\s]+):(\d+):(\d+)\)?\s*$/.exec(line);
    if (match && !match[1]!.startsWith('node:')) {
      return { file: match[1]!, line: Number(match[2]), column: Number(match[3]) };
    }
  }
  return undefined;
}

export function wrapLocator(locator: Locator, hooks: WrapHooks, callsite?: Callsite | undefined): Locator {
  const site = callsite ?? captureCallsite();
  return new Proxy(locator, {
    get(target, prop) {
      if (prop === RAW_TARGET) return target;
      // Receiver must be the raw target: Playwright internals may rely on
      // private state not reachable through the proxy.
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const name = typeof prop === 'string' ? prop : '';

      if (LOCATOR_CHAIN_METHODS.has(name)) {
        return (...args: unknown[]) =>
          wrapLocator(
            (value as (...a: unknown[]) => Locator).apply(target, unwrapArgs(args)),
            hooks,
            captureCallsite() ?? site,
          );
      }

      if (LOCATOR_ACTION_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          try {
            const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(
              target,
              unwrapArgs(args),
            );
            hooks.onActionSuccess?.(target, name, site);
            return result;
          } catch (error) {
            if (hooks.onActionFailure) {
              const replacement = await hooks.onActionFailure(target, {
                method: name,
                args,
                error: error as Error,
                callsite: site,
              });
              if (replacement) {
                const raw = unwrap(replacement);
                const method = (raw as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!;
                const result = await method.apply(raw, unwrapArgs(args));
                hooks.onActionSuccess?.(raw, name, site);
                return result;
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
          wrapLocator(
            (value as (...a: unknown[]) => Locator).apply(target, unwrapArgs(args)),
            hooks,
            captureCallsite(),
          );
      }

      return (...args: unknown[]) => value.apply(target, unwrapArgs(args));
    },
  });
}
