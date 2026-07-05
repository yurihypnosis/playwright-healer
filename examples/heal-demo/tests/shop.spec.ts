/**
 * Demo: run once to see everything green while Relocator records
 * fingerprints; the second test simulates the app's next release, where
 * the selectors your tests rely on have rotted — and heals at runtime.
 *
 *   pnpm --filter @relocator/example-heal-demo demo
 *
 * Watch the reporter output: healed tests are listed with their score and
 * the suggested replacement locator. Then run `relocator-patch` to turn
 * the heals into a reviewable code diff.
 */

import { test, expect } from '../fixtures.js';

const SHOP_V1 = `
  <html><body>
    <h1>Mini Shop</h1>
    <input id="coupon" placeholder="Coupon code" />
    <button id="apply-coupon" data-testid="apply-coupon"
            onclick="document.getElementById('status').textContent='applied: '+document.getElementById('coupon').value">
      Apply coupon
    </button>
    <p id="status"></p>
  </body></html>`;

// The next release: ids renamed, testid dropped, extra wrapper — classic rot.
const SHOP_V2 = SHOP_V1
  .replace('id="coupon"', 'id="coupon-input-field" class="css-1x2y3z"')
  .replace('id="apply-coupon" data-testid="apply-coupon"', 'id="btn-apply" class="css-9a8b7c"')
  .replace('<button', '<span class="btn-wrap"><button')
  .replace('</button>', '</button></span>')
  .replaceAll("getElementById('coupon')", "getElementById('coupon-input-field')");

test.describe.serial('coupon flow survives a release', () => {
  test('v1: green run records fingerprints', async ({ page }) => {
    await page.setContent(SHOP_V1);
    await page.locator('#coupon').fill('SAVE10');
    await page.getByTestId('apply-coupon').click();
    await expect(page.locator('#status')).toHaveText('applied: SAVE10');
  });

  test('v2: same test, rotted selectors — heals at runtime', async ({ page }) => {
    await page.setContent(SHOP_V2);
    await page.locator('#coupon').fill('SAVE10');          // id renamed → healed
    await page.getByTestId('apply-coupon').click();        // testid gone → healed
    await expect(page.locator('#status')).toHaveText('applied: SAVE10');
  });
});
