import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './app/tests/browser', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:3107', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: { command: 'node app/tests/browser/server.mjs', url: 'http://127.0.0.1:3107', reuseExistingServer: false },
});
