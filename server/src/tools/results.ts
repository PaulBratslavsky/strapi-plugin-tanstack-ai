/**
 * The two shapes an MCP tool hands back, written once for the tools that
 * share them.
 *
 * A refusal is a RESULT, never a throw. Strapi's MCP layer would turn a
 * throw into an opaque protocol error, and the chat bridge (lib/chat-tools.ts)
 * already turns `isError` into an exception the agent loop understands. Either
 * way the model gets the text, and the text names the fix.
 */
export const errorResult = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true as const,
});

export const okResult = <T extends Record<string, unknown>>(payload: T) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  structuredContent: payload,
});
