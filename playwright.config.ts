import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: './tests',
  // Bound Chromium instances for reliable release checks on developer laptops and CI.
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5174/api/health',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      CHAT_UPDATE_CHECK: '0',
      CHAT_USAGE_CHECK: '0',
      PORT: '13002',
      CHAT_API_PORT: '13002',
      CHAT_WEB_PORT: '5174',
      CHAT_DATA_DIR: resolve('.data/e2e'),
    },
  },
});
