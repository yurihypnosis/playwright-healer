/**
 * detectOnly (§8, monitoring profile): the engine finds and reports what it
 * WOULD heal to, but the failure must still surface — a missing element in
 * production is an incident, not something to paper over.
 */

import { rmSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { withRelocator } from '../src/index.js';

const STORE_DIR = '.relocator-detect-test';
const test = withRelocator(base, { dir: STORE_DIR, detectOnly: true });

const V1 = `<html><body><button id="buy" data-testid="buy">Buy now</button></body></html>`;
const V2 = `<html><body><button id="purchase-cta" class="css-z1">Buy now</button></body></html>`;

test.beforeAll(() => {
  rmSync(STORE_DIR, { recursive: true, force: true });
});

test.describe.serial('detect-only monitoring', () => {
  test('record on v1', async ({ page }) => {
    await page.setContent(V1);
    await page.getByTestId('buy').click();
  });

  test('v2: detects the candidate but lets the failure surface', async ({ page }) => {
    await page.setContent(V2);

    await expect(page.getByTestId('buy').click({ timeout: 1_000 })).rejects.toThrow();

    const detected = test.info().annotations.filter((a) => a.type === 'relocator-detected');
    expect(detected).toHaveLength(1);
    expect(detected[0]!.description).toContain('would heal to');
    expect(test.info().annotations.filter((a) => a.type === 'healed')).toHaveLength(0);
  });
});
