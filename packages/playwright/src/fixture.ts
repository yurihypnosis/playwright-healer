/**
 * The one-line integration point (design doc §9.1):
 *
 *   import { test as base } from '@playwright/test';
 *   import { withRelocator } from '@relocator/playwright';
 *   export const test = withRelocator(base);
 *
 * Existing test code keeps using page.getByRole()/page.locator() unchanged.
 */

import type { Page, PlaywrightTestArgs, TestType } from '@playwright/test';
import { getEngine, PageSession, type RelocatorOptions } from './engine.js';

export function withRelocator<T extends TestType<PlaywrightTestArgs, object>>(
  base: T,
  options: RelocatorOptions = {},
): T {
  if (process.env['RELOCATOR_DISABLE'] === '1') return base;
  return base.extend({
    page: async ({ page }: { page: Page }, use: (page: Page) => Promise<void>, testInfo) => {
      const engine = getEngine(options);
      const session = new PageSession(engine, page, testInfo);
      await use(session.wrappedPage);
      await session.dispose();
    },
  }) as T;
}
