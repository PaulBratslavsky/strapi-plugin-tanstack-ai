# strapi-plugin-tanstack-ai

Cross-type content tools for Strapi's MCP server, and an in-admin chat built on
[TanStack AI](https://github.com/TanStack/ai).

---

## Highlights

- **Search across every content type in one call**, which Strapi's per-type MCP
  tools cannot do.
- **Counts and breakdowns without fetching documents**, exact totals, and an
  explicit `partial` flag rather than a sample passed off as the whole.
- **A chat panel in the admin** with saved history, memory, notes, and a tool
  menu, driving those same tools.
- **Runs on Claude or on your own machine** through Ollama, where no content
  and no key leaves the box.
- **Permissions decide everything.** Every tool is gated by an admin action,
  and results are filtered by the caller's Content Manager grid.
- **Other plugins can contribute their own tools** to the chat without either
  plugin knowing about the other.

---

## Overview

The plugin has two halves, gated separately, and the split is the whole design:

| Half | Default | Needs an AI SDK? |
|---|---|---|
| **MCP tools** — `list_content_types`, `search_content`, `aggregate_content`, contributed to Strapi's official [MCP server](https://docs.strapi.io/cms/features/strapi-mcp-server) | always on | no |
| **Chat** — a panel inside the admin, driving those same tools | on | yes, and only then |

Install it for the tools alone and **no AI SDK is ever loaded or bundled**.
`@tanstack/ai` ships with the plugin, since every chat user needs it, but the
server reaches it through a single dynamic `import()` behind `chat.enabled`,
and the chat panel is a lazily-fetched chunk that only loads once chat is
ready. A missing key or adapter never stops Strapi booting: the chat page says
what to add, and the MCP tools work either way.

> Packaging claims here are checked against a real, empty Strapi.
> See [Verifying a clean install](docs/development.md#verifying-a-clean-install).

### Why these tools

Strapi's official MCP server publishes a tool set **per content type**:
`list_article`, `get_article`, `list_product`. Each is good, and none of them
can answer *"search everything I have for X"*, because that question is not
about a type, it is about the library.

- **`search_content`** — omit `contentType` and it fans out across every type
  the caller can read, in one call. Give one and it searches that type with
  filters and sorting.
- **`aggregate_content`** — `count` (omit `contentType` to total every type),
  `countByField` ("articles per category"; a relation such as `author` groups
  by its name) and `countByDateRange` (by day, week or month, in UTC). `total`
  is always exact. Grouping reads at most 10,000 documents and reports
  `partial: true` with the number `scanned` when there are more.
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
tools. That is not an error: a host may install this for the chat alone.

---

## Install

```bash
npm install strapi-plugin-tanstack-ai @tanstack/ai-anthropic
```

Two packages, and the second is a choice: the adapter for the model provider
the chat should use. `@tanstack/ai-anthropic` sends the conversation to Claude
and is what `chat.provider` defaults to. `@tanstack/ai-ollama` runs a model on
your own machine instead, with no key and nothing leaving it. Install exactly
one; everything else the chat needs ships with the plugin.

Only want the MCP tools? Install the plugin on its own and set
`chat: { enabled: false }`.

---

## Quick start

1. **Configure the provider** in `config/plugins.ts`:

   ```ts
   export default ({ env }) => ({
     'tanstack-ai': {
       enabled: true,
       config: {
         chat: {
           provider: 'anthropic',
           model: 'claude-sonnet-5',
           apiKey: env('ANTHROPIC_API_KEY'),
         },
       },
     },
   });
   ```

2. **Grant the tool permissions.** Settings → Administration Panel → Roles →
   *your role* → Plugins → TanStack AI → MCP tools. Do the same on the admin
   token your MCP client uses.

3. **Restart Strapi** and read one line of the boot log:

   ```
   [tanstack-ai] registered 3/3 MCP tool(s)
   [tanstack-ai] chat ENABLED
   ```

Open **TanStack AI** in the admin menu and ask it something about your content.

> **A tool that is not granted does not appear in `tools/list` at all, and
> nothing reports an error.** This is the single most common setup problem.
> See [Permissions](docs/permissions.md).

---

## Documentation

| | |
|---|---|
| [Permissions](docs/permissions.md) | Which action gates which tool, and how the Content Manager grid decides what a caller can read |
| [Configuration](docs/configuration.md) | Every option under `mcp.*` and `chat.*` |
| [The chat panel](docs/chat.md) | History, memory, notes, and what the context badge means |
| [Extending the chat](docs/extending.md) | Contributing tools from another plugin, or from your own app |
| [Development](docs/development.md) | Build, test, and verifying a clean install |

---

## Troubleshooting

**A tool doesn't show up in `tools/list`.**
In order of likelihood: the action is not granted (see
[Permissions](docs/permissions.md)); `mcp.enabled` is not set in
`config/server.ts`; or the MCP client cached the tool list from before the
grant, so reconnect it.

**A search returns nothing, or refuses a type, though the content exists.**
The caller has no **Read** on that type, or for a text search, on any of its
text fields. Check the token's grid for MCP, or the admin's role for the chat.

**`chat is enabled but @tanstack/ai-… could not be loaded`.**
The provider's adapter package is not installed. The message names the exact
`npm install` to run.

**The TanStack AI page shows a setup notice instead of the chat.**
Chat is off, or cannot run yet. The notice names the setting or package to add,
and the same reason is in the boot log. Restart Strapi after changing config.

---

## Contributing

Issues and pull requests are welcome. See
[Development](docs/development.md) for the build and test commands, and run
`npm run verify` before opening a PR.

---

## License

[MIT](LICENSE)
