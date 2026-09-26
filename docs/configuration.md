# Configuration

Everything lives under `tanstack-ai` in `config/plugins.ts`:

```ts
export default ({ env }) => ({
  'tanstack-ai': {
    enabled: true,
    config: {
      mcp: {
        toolPrefix: '',           // e.g. 'acme' → acme_search_content
        sizeLimitBytes: 950_000,  // wire budget
      },
      chat: {
        enabled: true,            // the default; false turns chat off
        provider: 'anthropic',    // or 'ollama'
        model: 'claude-sonnet-5',
        apiKey: env('ANTHROPIC_API_KEY'),  // anthropic only
        // baseURL: 'http://localhost:11434',  // ollama only
        // contextWindow: 32768,   // only if detection gets it wrong
        // toolSources: [],        // app services that contribute chat tools
      },
    },
  },
});
```

---

## `mcp.toolPrefix`

Prefixes the MCP-visible tool names. Empty by default, since no tool here
collides with a Strapi built-in. Set it if another plugin claims the same name.

Changing the prefix **does not move the permission actions**, which stay keyed
to the bare tool name. If they moved, setting a prefix would silently orphan
every existing grant: the tool would vanish from `tools/list` while the
checkbox that used to enable it stayed ticked.

## `mcp.sizeLimitBytes`

Budget for one tool result, **measured on the wire**. Every result is sent
*twice*, once as JSON text in `content` and once as `structuredContent`, so the
comparison is against roughly double the serialised payload.

Over budget, the tool returns a structured refusal naming how to narrow the
call (smaller `pageSize`, specific `fields`, one `contentType`) rather than
letting the client reject it with an opaque "result too large" the model cannot
act on.

## `chat.*`

`enabled: true` by default. To use it:

1. Install the adapter for your provider:
   ```bash
   npm install @tanstack/ai-anthropic      # or @tanstack/ai-ollama
   ```
2. Give that provider its credential: `apiKey` for Anthropic, `baseURL` for
   Ollama.

Nothing here stops Strapi booting. At boot the plugin checks whether chat can
actually run (config, credential, and the adapter package) and logs one line:
`chat ENABLED`, `chat disabled`, or a warning such as `chat is on but not
ready: Chat uses Anthropic but has no API key…`. The TanStack AI page shows the
same reason as a setup notice instead of a chat that fails on the first
message.

Set `enabled: false` to turn chat off; the page then says so. Only an unknown
`provider` is rejected at boot, because that is a typo rather than a missing
piece.

## `chat.contextWindow`

Only needed when the window cannot be detected, or when the detected value is
wrong. Ollama is asked directly and Anthropic's are published, so this is
usually better left unset: an override that drifts from reality is worse than
no number at all.

## `chat.toolSources`

Services in the host application that contribute chat tools, by uid. See
[Extending the chat](extending.md#tools-from-your-own-app).
