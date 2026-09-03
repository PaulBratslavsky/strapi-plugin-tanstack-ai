import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the plugin's admin surface.
 *
 * Assumes the demo stack is already running (strapi-backend on :1360). It does
 * NOT start it: the plugin has to be built and linked for these to mean
 * anything, and a config that boots its own server would happily test a stale
 * dist.
 *
 * These exist because curl is not a substitute. The panel's first bug — a 404
 * on /config — was invisible to curl, because a hand-typed URL tests that the
 * route exists, not that the client calls the right one. Only a browser
 * exercises the id the admin bundle actually compiled in.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:1360',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Logs in once and writes the session to disk. Every spec then starts
    // authenticated, which keeps the run under Strapi's login rate limit.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
    },
  ],
});
