import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the SERVER half only.
 *
 * The admin half is verified in a browser (`npm run test:e2e`), because what
 * broke there — a plugin-id mismatch, an auth read that missed a cookie — was
 * invisible to anything that did not run the built bundle.
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
    include: ['server/src/**/*.test.ts'],
    environment: 'node',
  },
});
