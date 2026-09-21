import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The admin login for auth.setup.ts lives in .env (gitignored), never in source.
if (existsSync('.env')) process.loadEnvFile('.env');

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
/** Set by `npm run test:e2e:model`; see the project config below. */
const MODEL_TESTS = process.env.MODEL_TESTS === '1';

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
      /**
       * `@model` tests are excluded by default and ONLY by default.
       *
       * They ask a real model to use a tool or an injected memory, and whether
       * it does is the MODEL's decision. As gates they fail when a local model
       * has an off day and report a defect that is not there. Run them
       * deliberately with `npm run test:e2e:model`.
       *
       * Selected by env rather than by `--grep` on the command line: a CLI
       * grep INTERSECTS with the project's own filter, so `--grep @model`
       * against `grepInvert: /@model/` matches nothing at all and reports "No
       * tests found" — which reads as the tests having been deleted.
       */
      ...(MODEL_TESTS ? { grep: /@model/ } : { grepInvert: /@model/ }),
    },
  ],
});
