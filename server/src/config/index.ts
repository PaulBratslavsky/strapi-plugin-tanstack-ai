/**
 * Plugin configuration.
 *
 * Two halves, gated separately, and the split is the whole design:
 *
 *   mcp   — always on. Contributes cross-type tools to Strapi's official MCP
 *           server. Pulls no AI SDK of any kind.
 *   chat  — opt-in, OFF by default. The only thing that reaches for the
 *           ESM-only `@tanstack/ai`, and only via a dynamic import.
 *
 * Why chat defaults to false: `@tanstack/ai` and `@tanstack/ai-react` are
 * declared as OPTIONAL peer dependencies, so a host installing this plugin for
 * the tools alone does not have to install them. Defaulting chat to true would
 * make the plugin crash on a host that took us at our word.
 */

export interface McpConfig {
  /**
   * Prefix for this plugin's MCP tool names, e.g. `tsai_search_content`.
   *
   * Strapi's official server already publishes per-content-type tools
   * (`list_article`, `get_article`). A prefix keeps ours distinguishable in a
   * client's tool list and, more importantly, prevents a collision from
   * silently shadowing a built-in.
   */
  toolPrefix: string;
  /**
   * Budget for a single tool result, in bytes ON THE WIRE.
   *
   * MCP clients reject an oversized result with an opaque error the model
   * cannot act on. Guarding here means the model gets a structured message
   * telling it to paginate instead.
   *
   * "On the wire" is the load-bearing part: every tool returns its payload
   * TWICE — once as JSON text in `content`, once as `structuredContent` — so
   * the budget is compared against roughly double the serialised result. See
   * `lib/size-guard.ts`.
   */
  sizeLimitBytes: number;
}

export interface ChatConfig {
  enabled: boolean;
  provider: 'anthropic' | 'ollama';
  model: string;
  /** Anthropic only. */
  apiKey?: string;
  /** Ollama only. */
  baseURL?: string;
}

export interface PluginConfig {
  mcp: McpConfig;
  chat: ChatConfig;
}

const defaults: PluginConfig = {
  mcp: {
    // Empty by default: neither tool collides with a Strapi built-in, and an
    // unprefixed `search_content` is what the tool descriptions and this
    // plugin's docs name. Set one if another plugin claims the same name.
    toolPrefix: '',
    // Just under the ~1 MB an MCP client will accept, counted doubled. A
    // tighter default would refuse legitimate cross-type results: 25 types x
    // 10 rows is easily 50 KB of JSON, which is 100 KB on the wire.
    sizeLimitBytes: 950_000,
  },
  chat: {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  },
};

export default {
  default: defaults,

  /**
   * Fail at BOOT, not at first use.
   *
   * A chat surface that is enabled but missing its credential should stop the
   * app starting, not wait for a user to send a message and get an opaque
   * provider error. Misconfiguration is a deployment problem, so it belongs in
   * the deployment's feedback loop.
   */
  validator(config: Partial<PluginConfig>) {
    const chat = config.chat;
    if (chat?.enabled) {
      if (chat.provider !== 'anthropic' && chat.provider !== 'ollama') {
        throw new Error(
          `[tanstack-ai] chat.provider must be 'anthropic' or 'ollama', got ${String(chat.provider)}`,
        );
      }
      if (chat.provider === 'anthropic' && !chat.apiKey) {
        throw new Error('[tanstack-ai] chat.enabled with provider "anthropic" requires chat.apiKey');
      }
      if (chat.provider === 'ollama' && !chat.baseURL) {
        throw new Error('[tanstack-ai] chat.enabled with provider "ollama" requires chat.baseURL');
      }
    }

    const mcp = config.mcp;
    if (mcp?.sizeLimitBytes !== undefined && mcp.sizeLimitBytes <= 0) {
      throw new Error('[tanstack-ai] mcp.sizeLimitBytes must be a positive number');
    }
  },
};
