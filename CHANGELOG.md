# Changelog

## 1.7.0 - 2026-10-18

Five more tools, ported from `strapi-plugin-ai-chat` so a host can drop that
plugin and keep everything it used. They keep the same names and the same
arguments, so prompts carry over unchanged. The result shapes are different
(see below), so a client that reads results needs a small change:

- `find_one_content`: one document by its `documentId`, relations populated.
- `create_content`: a new document, a draft unless `status` is `"published"`
  on a type with draft and publish.
- `update_content`: change fields on an existing document.
- `upload_media`: fetch a public URL into the media library.
- `send_email`: send an HTML email through the host's email provider.

Each one has its own permission action, `plugin::tanstack-ai.tool.<name>` with
dashes (for example `tool.find-one-content`), so there are now eight actions
and the boot log reads `registered 8/8 MCP tool(s)`. Grant the new ones to the
roles and admin tokens that need them. If both plugins are enabled on one
host, the tool names collide: set `mcp.toolPrefix` here, or disable one of
the two plugins.

### Behaviour differences from ai-chat: result shapes and publishing

The tool names and arguments match ai-chat's, but the **results do not**.
ai-chat's content tools returned `{ action, document }`. These return
`{ contentType, documentId, data }`. `upload_media` returns `{ file, usage }`
and `send_email` returns `{ sent, to, subject }`.

`create_content` with `status: "published"` now saves a draft first, checks
Publish against the saved document, and then publishes. If publishing is
refused, the draft stays saved and the error says so and names its
`documentId`. On a type without draft and publish, `create_content` and
`update_content` accept `status` and ignore it, as the document service does,
and do not ask for the Publish permission (the permissions grid offers none on
such types).

### Behaviour difference from ai-chat: the caller's permissions now apply

ai-chat's versions of these tools did not check who was calling. These do. The
content tools run as the caller and enforce Content Manager **Read**,
**Create** and **Update** on the type, plus **Publish** for
`status: "published"` on a type with draft and publish. Permission conditions such as "only entries I created"
apply, fields the caller cannot write are dropped from the input, and fields
they cannot read are left out of the result. A document that does not exist and
one a condition hides get the same "not found" answer. New and changed rows
record the caller as creator and updater.

So a token that worked with ai-chat's grants may now be refused until it also
holds the Content Manager permissions for the types it touches. Tick them on
the admin token, or on the role for the chat.

### `upload_media` is stricter about what it will fetch

It needs `plugin::upload.assets.create` (the media library's own upload
permission) as well as its action, and it refuses to be a way into the
network behind the server:

- The hostname is resolved and private and reserved addresses are refused. The
  check is pinned to the connection that is actually made, so a name that
  answers differently between the lookup and the connect (DNS rebinding) is
  still refused.
- Redirects are refused.
- The download is streamed under a 50 MB cap, which also holds for gzip and
  chunked responses where the declared length is missing or wrong.
- The operator's `plugin::upload.security` `allowedTypes` and `deniedTypes`
  apply, to both the response's Content-Type and, when it is a known type, the
  file name's extension. A built-in deny-list applies whatever the config says,
  because the media library serves those files from the site's own origin. As
  types it covers html, xhtml, svg, javascript, shell scripts and the XML
  family (xml, xslt, `multipart/related`, `message/rfc822`, HTML Components).
  As extensions it covers html, htm, xhtml, xht, shtml, svg, svgz, js, mjs,
  cjs, sh, php, xml, xsl, xslt, mht, mhtml and htc. php is refused by its
  extension only.
- The file is staged on disk under a fixed temporary name, so the name the
  model asks for is only a label. The caller is recorded as its creator.

It identifies itself with a User-Agent header, because some hosts refuse
anonymous downloads.

`send_email` is gated only by its own action, since Content Manager has no
permission for sending mail. Grant it deliberately. A failure now comes back as
an error rather than as `success: false` data, so the chat reports it as a
failure instead of describing it as a result.

### `chat.systemPrompt`

A new optional setting for standing instructions to the assistant:

```ts
chat: { systemPrompt: env('AI_SYSTEM_PROMPT') }
```

It sits first in the system prompt, ahead of the tool note and the saved
memories. A per-request `system` replaces it, and the context badge measures it
with the rest of the preamble. A value that is not a string is rejected at
boot.

## 1.6.0 - 2026-09-26

Both provider adapters now ship with the plugin, at exact versions, and no
`@tanstack/*` package is a peer dependency any more. The install is one line:

```bash
npm install strapi-plugin-tanstack-ai
```

Choosing between Claude and a local model is now a config change rather than
another package.

### Why: the optional peers produced a silently broken install

`@tanstack/ai-anthropic` was an optional peer at `^0.18.0`. Its own peer
requirement on the SDK moved while the plugin's did not:

| adapter | needs `@tanstack/ai` |
|---|---|
| `ai-anthropic@0.18.3` | `^0.52.0` |
| `ai-anthropic@0.18.10` | `^0.58.0` |
| `ai-anthropic@0.18.13` | `^0.59.0` |

So `npm install strapi-plugin-tanstack-ai @tanstack/ai-anthropic` resolved the
newest in range, and the install **succeeded** with two SDK copies:

```
0.52.3  node_modules/strapi-plugin-tanstack-ai/node_modules/@tanstack/ai
0.59.0  node_modules/@tanstack/ai
```

The plugin built an adapter against one and called `chat()` from the other: a
silent version mismatch rather than an error, which is the worst kind. Pinning
the whole set inside the plugin makes the graph unable to split. A clean
install of 1.6.0 alone yields exactly one `@tanstack/ai`.

The seam is unchanged. The SDK and the adapters are still reached only through
a dynamic `import()` behind `chat.enabled`, only the configured provider's
adapter is ever imported, and `check:seam` still proves no static require
survives the build.

## 1.5.1 - 2026-09-26

Documentation only, no code change.

The 1.5.0 README still described every `@tanstack/ai*` package as an optional
peer, and its clean-install check still expected `node_modules/@tanstack/ai*`
to match nothing. Both were true before 1.5.0 and false after it.

The install section now leads with the whole command rather than splitting the
plugin and the adapter across two blocks:

```bash
npm install strapi-plugin-tanstack-ai @tanstack/ai-anthropic
```

The README is also restructured to the shape a reader expects: what it is,
highlights, overview, install, a three-step quick start, then links. The
reference material it used to carry inline now lives in `docs/`, which ships
with the package:

```
docs/permissions.md     which action gates which tool, and what a caller can read
docs/configuration.md   every option under mcp.* and chat.*
docs/chat.md            history, memory, notes, the context badge
docs/extending.md       contributing tools from a plugin or from your own app
docs/development.md     build, test, verifying a clean install
```

Why the adapters stay optional peers while the SDK does not: every chat user
needs `@tanstack/ai`, and nobody chooses it. An adapter is a real either/or,
and the two differ by about 6x in installed size (`@tanstack/ai-anthropic`
pulls `@anthropic-ai/sdk`, around 9 MB; `@tanstack/ai-ollama` about 1.5 MB),
so shipping both would charge every install for the one it never loads.

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
