# strapi-plugin-tanstack-ai

Cross-type content tools for Strapi's MCP server, and an optional in-admin chat
built on [TanStack AI](https://github.com/TanStack/ai).

The plugin has **two halves, gated separately**, and the split is the whole
design:

| Half | Default | Needs an AI SDK? |
|---|---|---|
| **MCP tools** — `list_content_types`, `search_content`, `aggregate_content`, contributed to Strapi's official MCP server | always on | no |
| **Chat** — a chat panel inside the admin, driving those same tools | **off** | yes, and only then |

Install it for the tools alone and **no AI SDK is downloaded, imported, or
bundled**. Every `@tanstack/ai*` package is an *optional* peer dependency: the
server reaches them through a single dynamic `import()` behind `chat.enabled`,
and the admin's chat panel is a lazily-fetched chunk that is never loaded.

Verified, not asserted — see *Verifying a clean install* below.

---

## What the chat gives you

Turning `chat.enabled` on adds a panel to the admin. It is not just a text box
over an LLM:

| | |
|---|---|
| **History** | Every conversation is saved and reopened where you left it, with a sidebar to switch and delete. Scoped to the admin user who wrote it. |
| **Memory** | Facts the assistant keeps about you — "prefers short answers", "works on the pricing page" — replayed into the system prompt of every future turn, so they shape answers without you repeating yourself. It writes them itself; you can add and correct them. |
| **Notes** | Research, snippets and findings it saves on request, as markdown. Recalled on demand rather than injected, because a note is a document. |
| **Tools** | A menu listing every tool the model has and which plugin supplied it, with a switch per contributing plugin. |
| **Context** | What the conversation is costing: the preamble, what the model is actually serving, and a warning when the two are close. |

Each of memory, notes and history has a **management page** — search,
pagination, add, edit, delete — reached from a *Manage* link in its panel. The
panel is for glancing and quick fixes; the page is for when there are thirty of
something.

Those three content types are **hidden from the Content Manager on purpose**.
They are scoped per admin user, and the Content Manager has no per-row scoping —
exposing them there would show every admin everyone else's memories, notes and
transcripts. Strapi's "only entries created by the user" condition cannot
substitute either, since these rows are written by the document service rather
than through the Content Manager, so `createdBy` is never set.

### What the context badge is telling you

It reads something like `11K / 41K`, and both halves are worth understanding.

The first number is the **preamble** — your instructions plus every tool's
schema — measured for *you*, since the tool set is filtered by your role. Two
admins on one install can face very different preambles.

The second is what the model is **actually serving**, which is usually smaller
than what its weights support: Ollama is asked directly (`/api/show`), and its
`num_ctx` is the figure that matters. When the preamble is a large share of it,
the model does not error — it hangs, or answers while ignoring its tools, and
the obvious conclusion is that tool calling is broken. The badge turns an
afternoon of guessing into a glance, and warns before you get there.

All counts are estimates: a real tokeniser differs per model and would have to
ship per provider.

---

## Why these tools

Strapi's official MCP server publishes a tool set **per content type** —
`list_article`, `get_article`, `list_product`. Each is good, and none of them
can answer *"search everything I have for X"*, because that question is not
about a type; it is about the library.

- **`search_content`** — omit `contentType` and it fans out across every
  content type the caller can read, in one call. Give one and it searches that
  type with filters and sorting.
- **`aggregate_content`** — counts, breakdowns and trends without fetching the
  documents: `count` (omit `contentType` to total every type), `countByField`
  ("articles per category"; a relation such as `author` groups by its name) and
  `countByDateRange` (by day, week or month, in UTC). `total` is always exact.
  Grouping reads at most 10,000 documents, and says `partial: true` with the
  number `scanned` when there are more — so an answer never passes off a sample
  as the whole.
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
plugin::tanstack-ai.tool.aggregate-content
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

### What each tool can read

The tool action decides whether a caller may **use** a tool. It does not decide
**what content** they see. That comes from the same Content Manager permission
grid Strapi uses everywhere else:

| Caller | Whose grid |
|---|---|
| An MCP client | the **admin token's** — Settings → Admin Tokens → *your token* |
| The in-admin chat | the **logged-in admin's role** — Settings → Roles → *their role* |

- **Which types:** every row in that grid — the types Content Manager displays,
  including plugin types such as a users-permissions User. Types a plugin hides
  from Content Manager are never searched; this plugin's own conversations,
  memories and notes are hidden that way.
- **Which of those:** only types with **Read** ticked. `search_content` refuses
  a type asked for by name without it, and leaves it out of a fan-out
  completely — rows and counts. `list_content_types` does not describe it.
- **Which fields:** only readable ones. Filters, sorts and text searches on a
  hidden field are removed before the query runs, and hidden fields are
  stripped from every row.
- **Grouping is reading.** A group label is the field's value, so
  `aggregate_content` refuses to group or bucket by a field the caller cannot
  read, and refuses to group by a relation whose related type — or whose label
  field — they cannot read. It names what is missing rather than returning one
  misleading "(empty)" group.

So a token with `search-content` granted and nothing ticked in its content grid
can call the tool and gets nothing back. Tick **Read** on the types it should
see.

Two consequences worth knowing:

- **Text search matches readable fields only**, which is stricter than Content
  Manager's own search box. A number matches number fields exactly: `24` does
  not find `2400`.
- **Permissions are fixed per session.** After changing a role or token, start
  a new chat or reconnect the MCP client.

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
        // contextWindow: 32768,  // only if detection gets it wrong
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

### `chat.contextWindow`

Only needed when the window cannot be detected, or when the detected value is
wrong. Ollama is asked directly and Anthropic's are published, so this is
usually better left unset — an override that drifts from reality is worse than
no number at all.

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

**A search returns nothing, or refuses a type, though the content exists.**
The caller has no **Read** on that type — or, for a text search, on any of its
text fields. Check the token's grid for MCP, or the admin's role for the chat.
See *What each tool can read*.

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

## Tools from other plugins

Another Strapi plugin can contribute tools to this chat without either plugin
knowing about the other. It exposes a service named `ai-tools`:

```ts
// server/src/services/ai-tools.ts, in the contributing plugin
export default () => ({
  getTools: () => [
    {
      name: 'listTranscripts',
      description: 'List saved YouTube transcripts.',
      schema: z.object({ page: z.number().optional() }),
      execute: async (args, strapi) => { /* … */ },
    },
  ],
  getMeta: () => ({
    label: 'YouTube Transcripts',
    description: 'Fetch, search, list and read YouTube transcripts',
  }),
});
```

That is it — no registration call. This plugin walks `strapi.plugins` on each
chat request, and namespaces what it finds as `<plugin>__<tool>`, so a second
plugin's `search` cannot shadow the first's.

The contract is the reference plugin's, deliberately: a plugin written for
`strapi-plugin-ai-sdk` works here unchanged. Verified with
[`strapi-plugin-youtube-transcripts`](https://www.npmjs.com/package/strapi-plugin-youtube-transcripts)
installed from npm and not modified.

The **Tools** menu in the panel lists every tool the model has and which plugin
each came from. Contributed sources can be switched off there; the plugin's own
content tools and the memory/notes tools cannot, since a chat without them
cannot answer the questions it exists for. The selection is a per-person
browser preference, sent with each request as `forwardedProps.enabledToolSources`.

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
