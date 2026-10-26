import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  workers: 1,
  outputDir: process.env.CALENDAR_TEST_OUTPUT || 'test-results/browser',
  projects: [
    {name:'chromium',use:{browserName:'chromium',channel:process.env.CI ? undefined : 'chrome'}},
    {name:'firefox',use:{browserName:'firefox'}},
    {name:'webkit',use:{browserName:'webkit'}}
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    timezoneId: 'Asia/Shanghai'
  },
  webServer: {
    command:'node tools/calendar/serve.mjs',
    url:'http://127.0.0.1:4173/calendar-reminders/',
    reuseExistingServer:false,
    env:{CALENDAR_DB_PATH:':memory:',CALENDAR_STATIC_ROOT:'dist/site'}
  }
});
