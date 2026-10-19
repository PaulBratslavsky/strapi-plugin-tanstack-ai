# Permissions

Every tool is gated behind its own admin permission action:

```
plugin::tanstack-ai.tool.list-content-types
plugin::tanstack-ai.tool.search-content
plugin::tanstack-ai.tool.aggregate-content
plugin::tanstack-ai.tool.find-one-content
plugin::tanstack-ai.tool.create-content
plugin::tanstack-ai.tool.update-content
plugin::tanstack-ai.tool.upload-media
plugin::tanstack-ai.tool.send-email
```

**A tool that is not granted does not appear in `tools/list` at all, and
nothing reports an error.** Strapi enables an MCP capability per session only
when the caller's ability satisfies the tool's policy, and an ungranted action
satisfies nothing. The plugin logs a warning at boot when none of its actions
are granted to anybody, because this failure is otherwise invisible from both
ends.

Grant them in either place:

- **Admin users** — Settings → Administration Panel → Roles → *your role* →
  Plugins → TanStack AI → MCP tools.
- **The admin token your MCP client authenticates with** — Settings →
  Administration Panel → Admin Tokens → *your token*, or programmatically
  against `admin::permission`.

> These actions are deliberately **subject-less**: they ask "may this caller use
> this tool", not "may this caller read articles". Borrowing a Content Manager
> action instead does not work, because those grants are always scoped to one
> content type, so the subject-less check Strapi runs fails and the tool
> silently never appears.

---

## What the content, upload and email tools also check

The action lets a caller **use** the tool. The tools that change things check
more, as the caller, before they act:

| Action | Also needs |
|---|---|
| `find-one-content` | Content Manager **Read** on the type |
| `create-content` | Content Manager **Create** on the type, and **Publish** when `status` is `"published"` on a type with draft and publish |
| `update-content` | Content Manager **Update** on the type, and **Publish** when `status` is `"published"` on a type with draft and publish |
| `upload-media` | `plugin::upload.assets.create`, the media library's own upload permission |
| `send-email` | Nothing beyond the action |

Some details that follow from running as the caller:

- **Conditions apply.** `update_content` loads the draft with the permission
  populate Strapi uses, so an "is creator" condition is evaluated against the
  real row. A document that does not exist and one a condition hides get the
  same "not found" answer, so a caller cannot probe for ids.
- **Publishing is checked on the saved document.** The permissions grid only
  offers Publish on types with draft and publish, so on any other type `status`
  is ignored and Publish is never asked for. On a type that has it,
  `create_content` with `status: "published"` first checks Publish on the type
  and refuses before writing. It then saves a draft, checks Publish again
  against the saved document (so a condition such as "only mine" applies), and
  only then publishes. If that second check refuses, the draft stays saved and
  the error names its `documentId`.
- **Fields are filtered both ways.** Input is stripped of fields the caller may
  not write, and the row comes back through the read filter, since a caller can
  hold Create without Read. New and changed rows record the caller as creator
  and updater, so "only mine" conditions work afterwards.
- **`upload_media` fetches a URL on the server's behalf**, so it is
  deliberately strict. It resolves the hostname and refuses private and
  reserved addresses, and the check is made on the connection that is actually
  used, so a name that changes its answer between lookup and connect is still
  refused. Redirects are refused, so an allowed URL cannot bounce to a private
  one. The body is streamed under a 50 MB cap, which holds for gzip and chunked
  responses too. The operator's `plugin::upload.security` `allowedTypes` and
  `deniedTypes` are applied to both the response's Content-Type and the file
  name's extension, and a built-in deny-list applies whatever the config says.
  Refused as types: html, xhtml, svg, javascript, shell scripts and the XML
  family (xml, xslt, MHTML and mail wrappers, HTML Components). Refused as
  extensions: html, htm, xhtml, xht, shtml, svg, svgz, js, mjs, cjs, sh, php,
  xml, xsl, xslt, mht, mhtml and htc (php is refused by its extension only).
  The operator's allowed and denied rules look at the file name's extension
  only when it is a known type. The file is staged on disk under a fixed
  temporary name, so the name the model asks for is only a label, and the
  caller is recorded as its creator.
- **`send_email` has no Content Manager equivalent**, so its action alone is the
  authorisation: whoever holds it can send mail from the host's address to any
  recipient. Grant it deliberately. Failures, such as no email plugin or a
  provider refusal, come back as errors rather than as a successful result.

---

## What each tool can read

The tool action decides whether a caller may **use** a tool. It does not decide
**what content** they see. That comes from the same Content Manager permission
grid Strapi uses everywhere else:

| Caller | Whose grid |
|---|---|
| An MCP client | the **admin token's** — Settings → Administration Panel → Admin Tokens → *your token* |
| The in-admin chat | the **logged-in admin's role** — Settings → Administration Panel → Roles → *their role* |

- **Which types:** every row in that grid, meaning the types Content Manager
  displays, including plugin types such as a users-permissions User. Types a
  plugin hides from Content Manager are never searched; this plugin's own
  conversations, memories and notes are hidden that way.
- **Which of those:** only types with **Read** ticked. `search_content` refuses
  a type asked for by name without it, and leaves it out of a fan-out
  completely, rows and counts alike. `list_content_types` does not describe it.
- **Which fields:** only readable ones. Filters, sorts and text searches on a
  hidden field are removed before the query runs, and hidden fields are
  stripped from every row.
- **Grouping is reading.** A group label is the field's value, so
  `aggregate_content` refuses to group or bucket by a field the caller cannot
  read, and refuses to group by a relation whose related type, or whose label
  field, they cannot read. It names what is missing rather than returning one
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
