# Extending the chat

The chat offers the model three kinds of tool: this plugin's own content tools,
tools contributed by other installed plugins, and tools from services your own
application lists.

---

## Tools from another plugin

Another Strapi plugin can contribute tools without either plugin knowing about
the other. It exposes a service named `ai-tools`:

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

That is all, with no registration call. This plugin walks `strapi.plugins` on
each chat request and namespaces what it finds as `<plugin>__<tool>`, so a
second plugin's `search` cannot shadow the first's.

The contract is the reference plugin's, deliberately: a plugin written for
`strapi-plugin-ai-sdk` works here unchanged. Verified with
[`strapi-plugin-youtube-transcripts`](https://www.npmjs.com/package/strapi-plugin-youtube-transcripts)
installed from npm and not modified.

The **Tools** menu in the panel lists every tool the model has and which plugin
each came from. Contributed sources can be switched off there. The plugin's own
content tools and the memory and notes tools cannot, since a chat without them
cannot answer the questions it exists for. The selection is a per-person
browser preference, sent with each request as
`forwardedProps.enabledToolSources`.

---

## Tools from your own app

Strapi's MCP server already accepts a tool registered in an app's
`src/index.ts`, so a project can put a one-off tool on `/mcp` without
scaffolding a plugin. `chat.toolSources` is how that same tool also reaches the
chat:

```ts
chat: {
  toolSources: ['api::healthcheck.healthcheck'],
}
```

Each listed service exposes what a contributing plugin exposes:

```ts
export default ({ strapi }) => ({
  getTools() {
    return [
      {
        name: 'healthcheck',
        description: 'Is this Strapi healthy?',
        schema: z.object({}),
        action: 'api::healthcheck.run',   // the admin permission gating it
        execute: async () => strapi.service('api::healthcheck.healthcheck').run(),
      },
    ];
  },
  getMeta() {
    return { label: 'Healthcheck' };
  },
});
```

Tools are namespaced `<source>__<tool>` and gated by the action each one
declares, the same as a plugin's. Empty by default.

**Listed, never scanned.** Discovering app services by naming convention would
put tools in the chat that nothing in the config accounts for. Plugins remain
the primary way to ship tools, since a plugin owns its permissions and can be
installed in another project. This is for the one-off a project keeps to
itself.
