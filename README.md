# strapi-plugin-tanstack-ai

Cross-type content tools for Strapi's MCP server, and an optional in-admin chat
built on [TanStack AI](https://github.com/TanStack/ai).

The plugin has **two halves, gated separately**, and the split is the whole
design:

| Half | Default | Needs an AI SDK? |
|---|---|---|
| **MCP tools** — `list_content_types`, `search_content`, contributed to Strapi's official MCP server | always on | no |
| **Chat** — a chat panel inside the admin, driving those same tools | **off** | yes, and only then |

Install it for the tools alone and **no AI SDK is downloaded, imported, or
bundled**. Every `@tanstack/ai*` package is an *optional* peer dependency: the
server reaches them through a single dynamic `import()` behind `chat.enabled`,
and the admin's chat panel is a lazily-fetched chunk that is never loaded.

Verified, not asserted — see *Verifying a clean install* below.

---

## Why these tools

Strapi's official MCP server publishes a tool set **per content type** —
`list_article`, `get_article`, `list_product`. Each is good, and none of them
can answer *"search everything I have for X"*, because that question is not
about a type; it is about the library.

- **`search_content`** — omit `contentType` and it fans out across every
  `api::` type in one call. Give one and it searches that type with filters and
  sorting.
- **`list_content_types`** — the schema, with each field's **constraints**
  (`required`, `maxLength`, `enum`, `default`). A model told only that a field
  exists will send 90 characters to a column capped at 80 and burn its one
  attempt on the rejected write.

---

## Requirements

- Strapi **5.47+** (earlier versions have no `strapi.ai.mcp`)
- Strapi's MCP server enabled in `config/server.ts`:

  ```ts
  export default ({ env }) => ({
    // …
    mcp: { enabled: true },
  });
  ```

Without it the plugin still boots and logs that it found nowhere to register
tools. That is not an error — a host may install this for the admin chat alone.

## Install

```bash
npm install strapi-plugin-tanstack-ai
```

Then **grant the tool permissions**, which is not optional — see below.

---

## Granting permissions (read this one)

Each tool is gated behind its own admin permission action:

```
plugin::tanstack-ai.tool.list-content-types
plugin::tanstack-ai.tool.search-content
```

**A tool that is not granted does not appear in `tools/list` at all, and
nothing reports an error.** Strapi enables an MCP capability per session only
when the caller's ability satisfies the tool's policy; an ungranted action
satisfies nothing. The plugin logs a warning at boot when none of its actions
are granted to anybody, because this failure is otherwise invisible from both
ends.

Grant them either way:

- **Admin users** — Settings → Administration Panel → Roles → *your role* →
  Plugins → TanStack AI → MCP tools.
- **The admin API token your MCP client authenticates with** — Settings → API
  Tokens → *your token*, or programmatically against `admin::permission`.

> These actions are deliberately **subject-less**: they ask "may this caller use
> this tool", not "may this caller read articles". Borrowing a content-manager
> action instead does not work — those grants are always scoped to one content
> type, so the subject-less check Strapi runs fails and the tool silently never
> appears.

---

## Configuration

`config/plugins.ts`:

```ts
export default {
  'tanstack-ai': {
    enabled: true,
    config: {
      mcp: {
        toolPrefix: '',           // e.g. 'acme' → acme_search_content
        sizeLimitBytes: 950_000,  // wire budget; see below
      },
      chat: {
        enabled: false,           // opt-in
        provider: 'anthropic',    // or 'ollama'
        model: 'claude-sonnet-5',
        apiKey: env('ANTHROPIC_API_KEY'), // anthropic only
        // baseURL: 'http://localhost:11434', // ollama only
      },
    },
  },
};
```

### `mcp.toolPrefix`

Prefixes the MCP-visible tool names. Empty by default, since neither tool
collides with a Strapi built-in. Set it if another plugin claims the same name.

Changing the prefix **does not move the permission actions** — those stay keyed
to the bare tool name. If they moved, setting a prefix would silently orphan
every existing grant: the tool would vanish from `tools/list` while the checkbox
that used to enable it stayed ticked.

### `mcp.sizeLimitBytes`

Budget for one tool result, **measured on the wire**. Every result is sent
*twice* — once as JSON text in `content`, once as `structuredContent` — so the
comparison is against roughly double the serialised payload. Over budget, the
tool returns a structured refusal naming how to narrow the call (smaller
`pageSize`, specific `fields`, one `contentType`) rather than letting the client
reject it with an opaque "result too large" the model cannot act on.

### `chat.*`

`enabled: false` by default. Turning it on:

1. Install the optional peers you need:
   ```bash
   npm install @tanstack/ai @tanstack/ai-react react-markdown remark-gfm
   npm install @tanstack/ai-anthropic   # or @tanstack/ai-ollama
   ```
2. Set `chat.enabled: true` plus the provider's credential.

Config is validated **at boot**, so a chat enabled without its API key stops the
app starting instead of failing later, opaquely, for whoever sends the first
message. The admin menu link is registered only when chat is on, so the panel is
unreachable — rather than broken — in a tools-only install.

---

## Troubleshooting

**A tool doesn't show up in `tools/list`.**
In order of likelihood: the action is not granted (see above); `mcp.enabled` is
not set in `config/server.ts`; or the MCP client cached the tool list from
before the grant — reconnect it.

**`chat is enabled but @tanstack/ai could not be loaded`.**
The optional peer is not installed in the host app. The message names the exact
`npm install` to run.

**The chat menu item is missing.**
That is the design when `chat.enabled` is false. The link is registered from the
server's config response, so it fails closed.

---

## Development

```bash
npm run build        # build both halves
npm test             # unit tests (vitest, server half)
npm run test:e2e     # browser tests against a running admin (Playwright)
npm run check:seam   # assert no static AI-SDK import reaches the bundles
npm run verify       # all of the above, as CI would
```

`check:seam` is not ceremony: it reads the built bundles and fails if
`@tanstack/ai` is loaded statically anywhere, which is the one thing that would
quietly break the promise that a tools-only install needs no AI SDK. It caught a
regression where tree-shaking emitted a bare `import "@tanstack/ai";` with no
`from` clause.

The browser tests exist for the same reason: every server path here was
verified with curl and passed while the panel was broken, because the admin was
fetching a different plugin id than the server served. Only the built bundle
knows which id it compiled in.

## Verifying a clean install

The claim above is a packaging claim, so it is checked against a real, empty
Strapi rather than reasoned about:

```bash
npm run build && npm pack

cd /tmp
npx create-strapi-app@5 clean --non-interactive --no-run --typescript \
  --use-npm --dbclient=sqlite --skip-cloud --no-git-init --install
cd clean
npm install /path/to/strapi-plugin-tanstack-ai-0.1.0.tgz

ls node_modules/@tanstack/ai*   # expect: no matches
# add `mcp: { enabled: true }` to config/server.ts, then:
npm run build                   # the host's admin must build with NO SDK present
npm run start
```

A pass looks like:

```
[tanstack-ai] registered 2 permission action(s)
[tanstack-ai] registered 2/2 MCP tool(s); chat disabled
```

and `GET /tanstack-ai/config` returning `{"chat":{"enabled":false}}`.

Three real defects were found this way, none of them visible from a linked
development setup — because `resolve:` bypasses npm resolution and the host's
admin build entirely:

1. `react-intl` was declared as `^6.8.9`; Strapi ships `6.6.2`, so
   `npm install` failed outright with ERESOLVE.
2. The peer ranges pinned `^5.52.3` while the README promised Strapi 5.47+, so
   every host between those versions would have been rejected.
3. The admin bundle imported the optional SDK with a NAMED import. Strapi's
   admin build substitutes Vite's optional-peer stub for a missing package, and
   that stub exports nothing named — so a tools-only host could not build its
   admin panel at all. The panel now uses a namespace import, which binds
   nothing statically and resolves against the stub or the real package alike.

## License

MIT
