# The chat panel

The chat is a panel in the admin. It is not just a text box over an LLM:

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
They are scoped per admin user, and the Content Manager has no per-row scoping,
so exposing them there would show every admin everyone else's memories, notes
and transcripts. Strapi's "only entries created by the user" condition cannot
substitute either, since these rows are written by the document service rather
than through the Content Manager, so `createdBy` is never set.

---

## What the context badge is telling you

It reads something like `11K / 41K`, and both halves are worth understanding.

The first number is the **preamble**: your instructions plus every tool's
schema, measured for *you*, since the tool set is filtered by your role. Two
admins on one install can face very different preambles.

The second is what the model is **actually serving**, which is usually smaller
than what its weights support. Ollama is asked directly (`/api/show`), and its
`num_ctx` is the figure that matters. When the preamble is a large share of it,
the model does not error: it hangs, or answers while ignoring its tools, and
the obvious conclusion is that tool calling is broken. The badge turns an
afternoon of guessing into a glance, and warns before you get there.

All counts are estimates. A real tokeniser differs per model and would have to
ship per provider.
