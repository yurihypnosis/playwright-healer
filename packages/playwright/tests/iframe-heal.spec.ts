/**
 * iframe heal (§9.5): locators inside frameLocator chains record into a
 * per-frame fingerprint space and heal by scoring inside that frame.
 */

import { rmSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { withRelocator } from '../src/index.js';

const STORE_DIR = '.relocator-iframe-test';
const test = withRelocator(base, { dir: STORE_DIR });

const FRAME_V1 = `<button id="pay" data-testid="pay-btn"
  onclick="document.getElementById('r').textContent='paid'">Pay now</button><p id="r"></p>`;
const FRAME_V2 = `<button id="checkout-cta" class="css-p9q8"
  onclick="document.getElementById('r').textContent='paid'">Pay now</button><p id="r"></p>`;

const page = (frameHtml: string) => `
  <html><body>
    <h1>Host page</h1>
    <button id="host-decoy">Pay now</button>
    <iframe id="payframe" srcdoc="${frameHtml.replaceAll('"', '&quot;')}"></iframe>
  </body></html>`;

test.beforeAll(() => {
  rmSync(STORE_DIR, { recursive: true, force: true });
});

test.describe.serial('iframe migration', () => {
  test('v1: record the in-frame button', async ({ page: p }) => {
    await p.setContent(page(FRAME_V1));
    const frame = p.frameLocator('#payframe');
    await frame.getByTestId('pay-btn').click();
    await expect(frame.locator('#r')).toHaveText('paid');
  });

  test('v2: heals inside the frame, not to the host-page decoy', async ({ page: p }) => {
    await p.setContent(page(FRAME_V2));
    const frame = p.frameLocator('#payframe');

    await frame.getByTestId('pay-btn').click();
    await expect(frame.locator('#r')).toHaveText('paid');

    const healed = test.info().annotations.filter((a) => a.type === 'healed');
    expect(healed).toHaveLength(1);
    // The host page's same-text decoy must not have been clicked.
    expect(healed[0]!.description).not.toContain('host-decoy');
  });
});
