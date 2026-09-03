/**
 * Selectors over the SDK's message parts.
 *
 * Ported from the reference plugin's `hooks/useChat.ts`, which exports the same
 * four selectors for the same reason: the components should ask "what text is
 * in this message" and not know how the SDK lays parts out.
 *
 * THE ONE REAL DIFFERENCE between the two SDKs is here, not in the components.
 * The AI SDK models a tool invocation as ONE part (`tool-<name>`) that gains an
 * `output` field when the result arrives. TanStack models it as TWO parts — a
 * `tool-call` and, later, a `tool-result` that refers back by id. Joining them
 * here means `ToolCallDisplay` ports over almost verbatim, and the join lives
 * in one place instead of in every component that wants to know whether a tool
 * has finished.
 */

/** A tool invocation, with its result folded back in. */
export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  /** `undefined` until the matching tool-result arrives — the "still running" signal. */
  output?: unknown;
  state: string;
  error?: string;
}

type Part = {
  type: string;
  content?: unknown;
  id?: string;
  name?: string;
  arguments?: string;
  input?: unknown;
  toolCallId?: string;
  state?: string;
  error?: string;
};

export type Message = { id?: string; role: string; parts?: Part[] };

const partsOf = (message: Message): Part[] => message.parts ?? [];

/** All text in a message, in order, ignoring tool and thinking parts. */
export function messageText(message: Message): string {
  return partsOf(message)
    .filter((part) => part.type === 'text' && typeof part.content === 'string')
    .map((part) => part.content as string)
    .join('');
}

/**
 * Reasoning text, if the model emitted any.
 *
 * TanStack calls these `thinking` parts where the AI SDK calls them
 * `reasoning`; the content field differs too (`content` vs `text`).
 */
export function messageReasoningText(message: Message): string {
  return partsOf(message)
    .filter((part) => part.type === 'thinking' && typeof part.content === 'string')
    .map((part) => part.content as string)
    .join('');
}

/**
 * A tool-result's payload, as the panel wants to display it.
 *
 * The bridge hands the model `structuredContent` — an object — but the wire
 * carries a string, so it arrives back JSON-encoded. Parsing gives the links
 * row something to read; a result that isn't JSON is still worth showing raw.
 */
function decodeOutput(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

/**
 * Tool invocations in a message, in the order the model made them, each with
 * its result attached if one has arrived.
 */
export function messageToolCalls(message: Message): ToolCall[] {
  const parts = partsOf(message);
  const results = new Map<string, Part>();
  for (const part of parts) {
    if (part.type === 'tool-result' && part.toolCallId) results.set(part.toolCallId, part);
  }

  return parts
    .filter((part) => part.type === 'tool-call')
    .map((part) => {
      const result = part.id ? results.get(part.id) : undefined;
      return {
        toolCallId: part.id ?? '',
        toolName: part.name ?? 'tool',
        input: part.input,
        // Deliberately left `undefined` when no result part exists yet: every
        // caller treats that as "running", so an empty-object default here
        // would silently render finished tools as complete-with-no-data.
        output: result ? decodeOutput(result.content) : undefined,
        state: result?.state ?? part.state ?? 'awaiting-input',
        ...(result?.error ? { error: result.error } : {}),
      };
    });
}
