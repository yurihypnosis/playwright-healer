/**
 * Security masking (§13): what enters the fingerprint store must never
 * include input values, password-adjacent text, sensitive-autocomplete
 * context, or redact-listed content.
 */

import { readFileSync, rmSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { withRelocator } from '../src/index.js';

const STORE_DIR = '.relocator-mask-test';
const test = withRelocator(base, { dir: STORE_DIR, redact: ['.user-secret'] });

const APP = `
  <html><body>
    <section>
      <label for="pw">Super secret hint 42</label>
      <input id="pw" type="password" />
      <button id="pw-submit" onclick="void 0">Unlock</button>
    </section>
    <section>
      <input id="cc" autocomplete="cc-number" placeholder="4111 1111 1111 1111" />
    </section>
    <section class="user-secret">
      <span>token: abc123xyz</span>
      <button id="copy-token" onclick="void 0">Copy token</button>
    </section>
    <section>
      <input id="plain" placeholder="Search products" />
    </section>
  </body></html>`;

test.beforeAll(() => {
  rmSync(STORE_DIR, { recursive: true, force: true });
});

test('sensitive context never reaches the store', async ({ page }) => {
  await page.setContent(APP);

  await page.locator('#pw').fill('hunter2');
  await page.locator('#cc').fill('4111111111111111');
  await page.locator('#copy-token').click();
  await page.locator('#plain').fill('shoes');
  // Flush happens on dispose; force it by ending the test after actions.
});

test('store contents are clean', async () => {
  const store = readFileSync(`${STORE_DIR}/fingerprints.json`, 'utf8');

  // Input values are never captured at all.
  expect(store).not.toContain('hunter2');
  expect(store).not.toContain('4111111111111111');

  // Password-adjacent label text and cc placeholder are masked.
  expect(store).not.toContain('Super secret hint');
  expect(store).not.toContain('4111 1111');

  // Redact-listed section content is masked.
  expect(store).not.toContain('abc123xyz');
  expect(store).not.toContain('Copy token');

  // Non-sensitive fields keep full fidelity.
  expect(store).toContain('Search products');

  // The masked entries still exist (structure preserved, content masked).
  expect(store).toContain('■■■');
});
