# Permissions

Every tool is gated behind its own admin permission action:

```
plugin::tanstack-ai.tool.list-content-types
plugin::tanstack-ai.tool.search-content
plugin::tanstack-ai.tool.aggregate-content
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
