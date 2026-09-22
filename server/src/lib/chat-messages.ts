import type { ChatMessage } from '../services/chat';

/**
 * The chat request's message history, reduced to text turns.
 *
 * History is TEXT ONLY by design: the model re-runs a tool if it needs fresh
 * data, and a result from an earlier turn is not replayed. What arrives is
 * richer than that. TanStack AI's wire format (AG-UI, `uiMessagesToWire`)
 * sends an assistant turn that wrote text AND called a tool as
 * `{ role: 'assistant', content, toolCalls }`, followed by a separate
 * `{ role: 'tool', toolCallId, content }` result.
 *
 * So this PROJECTS each kept turn to `{ role, content }`, not merely filters
 * it. A filter that kept the original object dropped the `role: 'tool'`
 * result but let `toolCalls` ride along on the assistant turn, and Anthropic
 * rejects that pairing on the next message: "tool_use ids were found without
 * tool_result blocks immediately after" (400). A turn with a tool call and no
 * text carries no `content` string and is dropped whole.
 */
export function toChatMessages(raw: unknown[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (typeof content === 'string' && (role === 'user' || role === 'assistant')) {
      messages.push({ role, content });
    }
  }
  return messages;
}
