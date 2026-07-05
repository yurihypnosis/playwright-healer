import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  // Serial: the heal test depends on fingerprints recorded by the green test.
  workers: 1,
  reporter: [['list'], ['@relocator/reporter', { dir: '.relocator-test' }]],
  use: {
    headless: true,
    actionTimeout: 2_000,
  },
});
