import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  reporter: [['list'], ['@relocator/reporter', { html: 'relocator-report.html' }]],
  use: {
    headless: true,
    actionTimeout: 5_000,
  },
});
