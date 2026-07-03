/**
 * Spike B validation checklist. Each test answers one go/no-go question for
 * the public-API proxy integration (design doc §9.2). If these pass, the
 * fixture approach (c) is viable without touching Playwright internals.
 */

import { test, expect, type Locator } from '@playwright/test';
import { wrapPage, type ActionFailure, type Callsite } from '../src/wrap.js';

const PAGE_HTML = `
  <html><body>
    <button id="submit" onclick="this.textContent='clicked'">Submit</button>
    <ul>
      <li>plain item</li>
      <li>item with <span class="badge">badge</span></li>
    </ul>
    <label for="email">Email</label>
    <input id="email" type="text" />
    <button class="dup">A</button>
    <button class="dup">B</button>
  </body></html>`;

test('B1: actions work through the proxy and report success + callsite', async ({ page }) => {
  const successes: Array<{ method: string; callsite: Callsite | undefined }> = [];
  const wrapped = wrapPage(page, {
    onActionSuccess: (_l, method, callsite) => successes.push({ method, callsite }),
  });
  await wrapped.setContent(PAGE_HTML);

  await wrapped.locator('#submit').click();
  expect(await wrapped.locator('#submit').textContent()).toBe('clicked');

  expect(successes).toHaveLength(1);
  expect(successes[0]!.method).toBe('click');
  expect(successes[0]!.callsite?.file).toContain('proxy-validation.spec.ts');
  expect(successes[0]!.callsite?.line).toBeGreaterThan(0);
});

test('B2: chained locators stay intercepted (filter/nth/first/getBy*)', async ({ page }) => {
  const failures: ActionFailure[] = [];
  const wrapped = wrapPage(page, {
    onActionFailure: async (_l, f) => {
      failures.push(f);
      return null;
    },
  });
  await wrapped.setContent(PAGE_HTML);

  // Success path through a chain.
  await wrapped.locator('ul').locator('li').first().hover();

  // Failure path through a chain still hits the hook.
  await expect(
    wrapped.locator('ul').getByText('nonexistent').first().click({ timeout: 300 }),
  ).rejects.toThrow();
  expect(failures).toHaveLength(1);
  expect(failures[0]!.method).toBe('click');
  expect(failures[0]!.callsite?.file).toContain('proxy-validation.spec.ts');
});

test('B3: web-first assertions accept proxied locators', async ({ page }) => {
  const wrapped = wrapPage(page, {});
  await wrapped.setContent(PAGE_HTML);

  await expect(wrapped.getByRole('button', { name: 'Submit' })).toBeVisible();
  await expect(wrapped.locator('#email')).toBeEmpty();
  await expect(wrapped.locator('#nope')).toBeHidden();
  await expect(wrapped.locator('li').filter({ hasText: 'plain' })).toHaveCount(1);
});

test('B4: proxied locator as filter({ has }) argument', async ({ page }) => {
  const wrapped = wrapPage(page, {});
  await wrapped.setContent(PAGE_HTML);

  const withBadge = wrapped.locator('li').filter({ has: wrapped.locator('.badge') });
  await expect(withBadge).toHaveCount(1);
  await expect(withBadge).toContainText('item with');
});

test('B5: failure classification signals are reachable from the hook', async ({ page }) => {
  const failures: ActionFailure[] = [];
  const wrapped = wrapPage(page, {
    onActionFailure: async (_l, f) => {
      failures.push(f);
      return null;
    },
  });
  await wrapped.setContent(PAGE_HTML);

  // selector-not-found -> TimeoutError with configurable (split) timeout.
  const start = Date.now();
  await expect(wrapped.locator('#missing').click({ timeout: 500 })).rejects.toThrow();
  expect(Date.now() - start).toBeLessThan(5_000);
  expect(failures[0]!.error.name).toBe('TimeoutError');

  // strict mode violation (selector-ambiguous) is distinguishable.
  await expect(wrapped.locator('.dup').click({ timeout: 500 })).rejects.toThrow();
  expect(failures[1]!.error.message).toContain('strict mode violation');
});

test('B6: heal-and-retry — replacement locator completes the action', async ({ page }) => {
  let healed = false;
  const wrapped = wrapPage(page, {
    onActionFailure: async (_l, failure): Promise<Locator | null> => {
      if (failure.error.name !== 'TimeoutError') return null;
      healed = true;
      return wrapped.locator('#submit');
    },
  });
  await wrapped.setContent(PAGE_HTML);

  // '#old-submit' rotted; the hook heals it to '#submit'.
  await wrapped.locator('#old-submit').click({ timeout: 500 });

  expect(healed).toBe(true);
  await expect(wrapped.locator('#submit')).toHaveText('clicked');
});

test('B7: fingerprint-capture prerequisites — elementHandle and evaluate work post-action', async ({ page }) => {
  const wrapped = wrapPage(page, {});
  await wrapped.setContent(PAGE_HTML);

  const input = wrapped.locator('#email');
  await input.fill('user@example.com');
  await input.press('Tab');

  const handle = await input.elementHandle();
  expect(handle).not.toBeNull();
  const tag = await input.evaluate((el) => el.tagName.toLowerCase());
  expect(tag).toBe('input');
  await expect(input).toHaveValue('user@example.com');
});

test('B8: proxied page passes as a regular Page elsewhere', async ({ page }) => {
  const wrapped = wrapPage(page, {});
  await wrapped.setContent(PAGE_HTML);

  // Common page-level APIs still work through the generic wrap.
  expect(await wrapped.title()).toBe('');
  const count = await wrapped.evaluate(() => document.querySelectorAll('button').length);
  expect(count).toBe(3);
  await wrapped.waitForSelector('#submit');
  const shot = await wrapped.screenshot();
  expect(shot.byteLength).toBeGreaterThan(0);
});
