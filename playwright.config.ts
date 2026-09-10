import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure',
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'tablet', use: { ...devices['iPad Mini'], defaultBrowserType: 'chromium' } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: 'npm run build -w @lager/api && node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3001/api/health/live',
      env: { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3001', DATABASE_URL: '' },
      reuseExistingServer: !process.env.CI, timeout: 60000,
    },
    {
      command: 'npm run dev -w @lager/web',
      env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'local-test-public-key' },
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI, timeout: 60000,
    },
  ],
});
