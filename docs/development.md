# Development

```bash
npm run build        # build both halves
npm test             # unit tests (vitest, server half)
npm run test:e2e     # browser tests against a running admin (Playwright)
npm run check:seam   # assert no static AI-SDK import reaches the bundles
npm run verify       # all of the above, as CI would
```

`check:seam` is not ceremony. It reads the built bundles and fails if
`@tanstack/ai` is loaded statically anywhere, which is the one thing that would
quietly break the promise that a tools-only install never loads an AI SDK. It
caught a regression where tree-shaking emitted a bare `import "@tanstack/ai";`
with no `from` clause.

The browser tests exist for the same reason. Every server path here was
verified with curl and passed while the panel was broken, because the admin was
fetching a different plugin id than the server served. Only the built bundle
knows which id it compiled in.

They log in to the admin once and reuse the session saved in `e2e/.auth/`. Only
when that session is missing or expired do they need a login, from
`STRAPI_ADMIN_EMAIL` and `STRAPI_ADMIN_PASSWORD`: copy `.env.example` to `.env`
and fill in an admin on the Strapi at `localhost:1360`, or export the two
variables in your shell.

---

## Verifying a clean install

Packaging claims are checked against a real, empty Strapi rather than reasoned
about:

```bash
npm run build && npm pack

cd /tmp
npx create-strapi-app@5 clean --non-interactive --no-run --typescript \
  --use-npm --dbclient=sqlite --skip-cloud --no-git-init --install
cd clean
npm install /path/to/strapi-plugin-tanstack-ai-<version>.tgz

ls node_modules/@tanstack/    # expect: ai, ai-react. No provider adapter.
# add `mcp: { enabled: true }` to config/server.ts, then:
npm run build                 # the host's admin must build with NO adapter present
npm run start
```

A pass looks like:

```
[tanstack-ai] registered 3 permission action(s)
[tanstack-ai] chat is on but not ready: Chat uses Anthropic but has no API key. …
[tanstack-ai] registered 3/3 MCP tool(s)
```

and `GET /tanstack-ai/config` returning `"ready": false` with that reason.

Three real defects were found this way, none of them visible from a linked
development setup, because `resolve:` bypasses npm resolution and the host's
admin build entirely:

1. `react-intl` was declared as `^6.8.9`; Strapi ships `6.6.2`, so
   `npm install` failed outright with ERESOLVE.
2. The peer ranges pinned `^5.52.3` while the README promised Strapi 5.47+, so
   every host between those versions would have been rejected.
3. The admin bundle imported the optional SDK with a NAMED import. Strapi's
   admin build substitutes Vite's optional-peer stub for a missing package, and
   that stub exports nothing named, so a tools-only host could not build its
   admin panel at all. The panel now uses a namespace import, which binds
   nothing statically and resolves against the stub or the real package alike.
