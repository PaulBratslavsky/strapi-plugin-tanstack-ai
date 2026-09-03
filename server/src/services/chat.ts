import type { Core } from '@strapi/strapi';
import { readConfig } from '../lib/plugin-config';
import { loadAI, loadAdapter } from '../lib/tanstack-ai';
import { buildChatTools, type CallerAbility } from '../lib/chat-tools';

/**
 * In-admin chat, powered by TanStack AI.
 *
 * THIS IS THE ONLY PART OF THE PLUGIN THAT TOUCHES AN AI SDK. Tools and MCP
 * registration deliberately do not, which is why chat can be off by default
 * and the SDK can be an optional peer. Everything here runs behind
 * `chat.enabled`; nothing above it imports this module at load time.
 */

/** A turn as the admin UI sends it. */
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/**
 * Keep the last N turns.
 *
 * A conversation that outgrows the model's window fails at the provider, late,
 * with an error the user cannot act on. Trimming to a fixed count is crude but
 * predictable, and it fails in the direction of losing old context rather than
 * losing the request.
 */
const MAX_TURNS = 20;

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Stream an answer.
   *
   * Returns the SDK's SSE `Response`; the controller is responsible for
   * getting it onto Koa, which is not the same thing (see controllers/chat.ts).
   */
  async stream(
    messages: ChatMessage[],
    options?: { system?: string; ability?: CallerAbility },
  ) {
    const config = readConfig(strapi);
    if (!config.chat.enabled) {
      // Defence in depth. The route is not registered when chat is off, so
      // reaching here means something else called the service directly.
      throw new Error('[tanstack-ai] chat is disabled — set chat.enabled in the plugin config');
    }

    // Both loads are dynamic and happen HERE, not at module scope: this is the
    // moment the plugin first needs the SDK, and a host with chat off never
    // reaches it.
    const { chat, toServerSentEventsResponse } = await loadAI();
    const adapter = await loadAdapter({
      provider: config.chat.provider,
      model: config.chat.model,
      apiKey: config.chat.apiKey,
      baseURL: config.chat.baseURL,
    });

    // Filtered by the caller's own grants, so the model is offered exactly the
    // tools this admin could have used over MCP — no more.
    const tools = await buildChatTools(strapi, { ability: options?.ability });

    const trimmed = messages.slice(-MAX_TURNS);

    // Anthropic takes a separate top-level `system`; Ollama wants a system
    // TURN in the array and silently ignores the parameter. Getting this
    // backwards does not error — it drops the system prompt and produces a
    // fluent answer with none of the instructions applied.
    // DERIVED from the tools actually passed, never hand-written. A prompt
    // that advertises a tool the model was not given makes it promise things
    // it cannot do; one that omits a tool it has makes it never reach for it.
    const toolNames = tools.map((t) => (t as { name?: string }).name).filter(Boolean);
    const toolNote =
      toolNames.length > 0
        ? `\n\nTOOLS AVAILABLE: ${toolNames.join(', ')}. Use them to answer questions ` +
          'about this Strapi instance\'s content rather than guessing.'
        : '';
    const system = options?.system ? `${options.system}${toolNote}` : toolNote || undefined;
    const isAnthropic = config.chat.provider === 'anthropic';

    // `stream: true` is explicit, not decorative: chat()'s return type is a
    // union over a TStream boolean, and without narrowing it TypeScript keeps
    // the non-streaming Promise branch — which then fails to match
    // toServerSentEventsResponse with an error about async iterators that says
    // nothing about the real cause.
    const stream = chat({
      adapter,
      stream: true,
      messages: (isAnthropic || !system
        ? trimmed
        : [{ role: 'system', content: system }, ...trimmed]) as never,
      ...(isAnthropic && system ? { systemPrompts: [system] } : {}),
      ...(tools.length > 0 ? { tools } : {}),
    });

    return toServerSentEventsResponse(stream);
  },
});
