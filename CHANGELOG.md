# Changelog

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

### Upgrading

A token or role that could search everything before sees only the types ticked
in its grid now. If a client suddenly finds nothing, tick **Read** on the
types it should see.

## 1.0.0 - 2026-09-08

First release: `list_content_types` and `search_content` for Strapi's MCP
server, and an opt-in in-admin chat on TanStack AI with history, memory, notes,
a tool picker and a context gauge.
