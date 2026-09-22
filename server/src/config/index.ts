/**
 * Plugin configuration.
 *
 * Two halves, gated separately, and the split is the whole design:
 *
 *   mcp   — always on. Contributes cross-type tools to Strapi's official MCP
 *           server. Pulls no AI SDK of any kind.
 *   chat  — ON by default since 1.3.0. The only thing that reaches for the
 *           ESM-only `@tanstack/ai`, and only via a dynamic import.
 *
 * Chat defaulted to false through 1.2.x, because `@tanstack/ai` and the
 * provider adapters are OPTIONAL peer dependencies and an enabled chat with a
 * missing key crashed the boot. Neither is fatal any more: a missing
 * credential or package makes chat "not ready" (lib/chat-status.ts), which is
 * logged at boot and explained on the chat page, while Strapi starts normally.
 * That is what makes a default of true safe for a tools-only host.
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
  /**
   * The model's context window, when it cannot be detected.
   *
   * Ollama is asked directly (`/api/show`) and Anthropic's are published, so
   * this is only needed for a provider or model neither route covers — and to
   * override a detected value that is wrong.
   */
  contextWindow?: number;
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
    enabled: true,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  },
};

export default {
  default: defaults,

  /**
   * Reject config that is WRONG, not config that is incomplete.
   *
   * An unknown provider is a typo, and failing the boot is the right feedback.
   * A missing credential is not: chat is on by default, so a host that never
   * wanted chat has no key, and throwing would stop it booting. That case is
   * reported by lib/chat-status.ts instead — a boot warning and a notice on
   * the chat page, both naming the setting to add.
   */
  validator(config: Partial<PluginConfig>) {
    const chat = config.chat;
    if (chat?.enabled && chat.provider !== 'anthropic' && chat.provider !== 'ollama') {
      throw new Error(
        `[tanstack-ai] chat.provider must be 'anthropic' or 'ollama', got ${String(chat.provider)}`,
      );
    }

    const mcp = config.mcp;
    if (mcp?.sizeLimitBytes !== undefined && mcp.sizeLimitBytes <= 0) {
      throw new Error('[tanstack-ai] mcp.sizeLimitBytes must be a positive number');
    }
  },
};
