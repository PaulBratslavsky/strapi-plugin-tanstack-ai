# Changelog

## 1.5.0 - 2026-09-26

`@tanstack/ai` and `@tanstack/ai-react` are now ordinary dependencies of this
plugin, rather than optional peer dependencies.

Chat has been on by default since 1.3.0, but the packages it needs were
optional peers, which npm deliberately does not install. So the default
install produced a plugin whose headline feature reported itself broken:

```
warn: [tanstack-ai] chat is on but not ready: chat is enabled but
@tanstack/ai could not be loaded. It is an optional peer dependency...
```

A feature that is on by default cannot depend on packages the install skips.
Installing the plugin now gives you a working chat, and the only package left
to add is the adapter for your provider:

```bash
npm install strapi-plugin-tanstack-ai
npm install @tanstack/ai-ollama      # or @tanstack/ai-anthropic
```

The adapters stay optional peers on purpose: you use exactly one, and a host
that installed this for the MCP tools should not carry the other.

What has not changed is the seam. The SDK is still reached only through a
dynamic `import()` behind `chat.enabled`, and `npm run check:seam` still
asserts that no static require of it survives in the built bundle. It is on
disk now, but a tools-only host never loads it.

## 1.4.0 - 2026-09-26

The chat can now offer tools the APPLICATION provides, not only tools from
installed plugins.

Strapi's MCP server already accepts a tool registered in an app's
`src/index.ts`, so a project can put a one-off tool on `/mcp` without
scaffolding a plugin. The chat could not see those, which made the split an
implementation detail rather than a decision. A project now names the services
it wants offered:

```ts
'tanstack-ai': {
  config: {
    chat: {
      toolSources: ['api::healthcheck.healthcheck'],
    },
  },
}
```

Each listed service exposes the same contract a contributing plugin does —
`getTools()`, optionally `getMeta()` — and each tool declares the admin
permission action gating it, which the chat checks against the caller's role
exactly as it does for a plugin's tools. Tools are namespaced `<source>__<tool>`
the same way.

LISTED, NEVER SCANNED: discovering app services by naming convention would put
tools in the chat that nothing in the config accounts for. Plugins remain the
primary way to ship tools — they own their permissions and can be installed
elsewhere; this is for the one-off a project keeps to itself.

Defaults to `[]`, so nothing changes for an existing install.

## 1.3.1 - 2026-09-22

Fixes the admin chat failing with an Anthropic 400 on the message after a tool
call: "tool_use ids were found without tool_result blocks immediately after".

The chat sends its history in TanStack AI's wire format, where an assistant
turn that wrote text and called a tool arrives as `{ role, content, toolCalls }`
followed by a separate `{ role: 'tool' }` result. History is text only, so the
result was dropped, but the controller kept the assistant turn as sent, with
`toolCalls` still attached. The history is now reduced to `{ role, content }`
per turn (`lib/chat-messages.ts`). Turns with a tool call and no text were
already dropped, which is why only some conversations failed.

## 1.3.0 - 2026-09-22

Fixes the TanStack AI admin page showing "Page not found", and turns chat on
by default.

- **Fix: "Page not found" on the TanStack AI page.** The admin waited for the
  server's chat config before adding its menu link, but Strapi builds its
  routes without waiting for plugins. When that request was slower than the
  router, as it often was on Strapi Cloud, the sidebar showed the icon with no
  page behind it. The menu link is now added immediately, and the page itself
  checks whether chat can run.
- **Chat is on by default.** `chat.enabled` now defaults to `true`.
- **A missing key no longer stops Strapi booting.** Chat on with no API key
  (Anthropic) or server URL (Ollama), or without the optional `@tanstack/*`
  packages, now leaves chat "not ready" instead of failing the boot. Strapi
  logs a warning naming what to add, and the TanStack AI page shows the same
  notice instead of the chat. An unknown `provider` is still rejected at boot.
- `GET /tanstack-ai/config` now returns `{ chat: { enabled, ready, reason? } }`.
  `enabled` keeps its old meaning, so an older admin bundle still works.
- The boot log line is split: `registered N/N MCP tool(s)`, and a separate
  `chat ENABLED`, `chat disabled` or `chat is on but not ready: …`.

Upgrading: a host that relied on chat being off by default should set
`chat.enabled: false`. Otherwise the TanStack AI page shows a setup notice
until a key is configured.

## 1.2.0 - 2026-09-14

Adds `aggregate_content`: counts, breakdowns and trends, answered with numbers
instead of pages of documents.

"How many articles per category?" used to mean `search_content` pulling
documents into the model's context to be counted by eye, which is slow and
wrong past the first page. Strapi's own MCP tools do not count or group.

- `count` totals one type, or every type the caller can read when
  `contentType` is omitted
- `countByField` groups by a field. A relation groups by the related type's
  name, title or similar; `author.email` picks the field
- `countByDateRange` buckets by day, week or month, with an optional
  `dateFrom` / `dateTo`. Weeks start on Monday, and all buckets are UTC
- `total` is always an exact count. Grouping reads at most 10,000 documents,
  selecting only the field it needs, and reports `scanned` and `partial: true`
  when there were more

It follows the same permission rules as `search_content`. Grouping is itself a
read, so it also refuses to group by a field, a date field, a related type, or
a related label field the caller cannot read.

Ported from the reference plugin's tool, with two of its defects fixed: it
stopped at 1,000 documents and presented the groups as complete, and it worked
out the week in the server's local time, so a server west of UTC filed Monday
morning under the previous week.

### Upgrading

Grant `plugin::tanstack-ai.tool.aggregate-content` to the roles and admin
tokens that should see the tool. Until it is granted, the tool does not appear.

## 1.1.0 - 2026-09-14

**Security fix.** In 1.0.0, `search_content` returned content the caller was
not allowed to read. Upgrade if an MCP token or admin role holds the
`search-content` action but has anything unticked in its Content Manager grid.

The tool's own action only answered "may this caller use `search_content`".
The handler then read through `strapi.documents()`, which checks no
permissions, across every `api::` type. Confirmed against a running server: a
token that Strapi's own `list_product` refused got every Product back from
`search_content`.

Both tools now read exactly what the caller's Content Manager grid allows: the
admin token's grid over MCP, the logged-in admin's role in the chat. This
follows the same steps as Content Manager's own list handler.

- Types the caller has no **Read** on are refused by name and left out of a
  fan-out entirely, including its counts
- Filters, sorts, fields and populates on hidden fields are removed before the
  query runs, and the permission's conditions (e.g. "only entries I created")
  are applied
- Hidden fields are stripped from every row
- `list_content_types` no longer describes types the caller cannot read, and
  asking for one by name gets the same answer as a type that does not exist,
  so guessed uids cannot be probed
- Both tools refuse to run without the caller's permissions, rather than
  treating that as unrestricted. The admin chat now passes the admin's; it
  passed nothing before

**Text search matches readable fields only.** Strapi's `_q` searches every
text field and is not touched by permission sanitising, so a caller who could
read Products but not `price` could search `2400` and learn the price from
which row came back. The search is now built as ordinary filters over the
schema and sanitised like any other. A number matches number fields exactly,
where `_q` matched by substring.

**Plugin content types are searchable.** The types searched are the rows of
the permission grid, not just `api::`. A plugin type an operator can grant,
such as a users-permissions User or a transcript, is now included when Read is
ticked. Types hidden from Content Manager, including this plugin's own
conversations, memories and notes, are never searched.

**The Anthropic chat provider works.** `anthropic` is the default chat
provider, and in 1.0.0 it could not answer: the adapter was built with
`createAnthropicChat({ apiKey, model })`, but the factory takes
`(model, apiKey)`, so every request named a model called `[object Object]`. A
hand-written type for the dynamically imported package hid the mistake; the
factories are now typed from the packages themselves. Ollama was unaffected.

### Upgrading

A token or role that could search everything before sees only the types ticked
in its grid now. If a client suddenly finds nothing, tick **Read** on the
types it should see.

## 1.0.0 - 2026-09-08

First release: `list_content_types` and `search_content` for Strapi's MCP
server, and an opt-in in-admin chat on TanStack AI with history, memory, notes,
a tool picker and a context gauge.
