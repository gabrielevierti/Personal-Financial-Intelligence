import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Usa il browser di Playwright se installato, altrimenti Chrome di sistema.
const systemChrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
const launchOptions = process.env.PW_USE_BUNDLED || !systemChrome ? {} : { executablePath: systemChrome };

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    launchOptions,
  },
  webServer: [
    {
      command: 'npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // Enable Banking simulato + bridge locale, per i test del collegamento bancario
      command: 'node e2e/bank-test-servers.mjs',
      url: 'http://127.0.0.1:8788/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
