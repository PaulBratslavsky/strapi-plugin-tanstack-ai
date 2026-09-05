import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the server half, and for admin logic that is genuinely pure.
 *
 * MOST of the admin half is verified in a browser (`npm run test:e2e`), because
 * what broke there — a plugin-id mismatch, an auth read that missed a cookie,
 * a Tooltip that could not take a ref — was invisible to anything that did not
 * run the built bundle. What lives here instead is the arithmetic: rules like
 * "clamp the page when the list shrinks" are exercised by a specific sequence
 * of clicks, and reproducing that through a rendered component is more
 * machinery than the rule deserves.
 */
export default defineConfig({
  resolve: {
    alias: {
      /**
       * `@strapi/core`'s ESM build does `import ... from 'lodash/fp'`, a
       * DIRECTORY import. Node's ESM resolver rejects those, so importing
       * anything that reaches Strapi's runtime — which the tool definitions do,
       * via `ai.mcp.defineTool` — fails to load before a single test runs.
       * Pointing at the file the error itself names is the whole fix.
       */
      'lodash/fp': 'lodash/fp.js',
    },
  },
  test: {
    server: {
      deps: {
        /**
         * Process Strapi through Vite instead of handing it to Node's ESM
         * loader. Without this the alias above never applies — an externalised
         * dependency is resolved by Node, which is precisely the resolver that
         * rejects the directory import.
         */
        inline: [/@strapi\//],
      },
    },
    include: ['server/src/**/*.test.ts', 'admin/src/**/*.test.ts'],
    environment: 'node',
  },
});
