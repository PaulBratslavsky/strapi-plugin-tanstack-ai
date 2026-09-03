/**
 * Keep a tool result under the MCP client's response limit.
 *
 * Ported from the reference plugin's `mcp/size-guard.ts`, for the reason its
 * header gives: an oversized result comes back to the agent as an opaque
 * "Tool result is too large", which it cannot act on — it has no idea it should
 * paginate. A structured refusal that names the fix turns a dead end into a
 * retry that differs from the first attempt.
 *
 * THE NON-OBVIOUS PART, and the reason to read that file rather than guess a
 * limit: the payload rides the wire TWICE. Every tool here returns it once as
 * JSON text in `content` and again as `structuredContent`, so a result that
 * measures 600 KB arrives as ~1.2 MB. Measuring one copy passes results that
 * then fail at the client.
 */

/** Serialisation overhead of the envelope around the two copies. */
const ENVELOPE_BYTES = 2048;

/** What a tool should be told to do about an oversized result. */
function shrinkHint(toolName: string): string {
  switch (toolName) {
    case 'search_content':
      return 'Re-issue with a smaller pageSize, name specific `fields`, scope it to one `contentType`, or leave includeContent off.';
    case 'list_content_types':
      return 'Re-issue for a single content type by name.';
    default:
      return 'Re-issue with a smaller page size, or request fewer fields.';
  }
}

/** What a result will actually weigh on the wire, both copies plus envelope. */
export function wireBytes(payload: unknown): number {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) return 0;
  return Buffer.byteLength(serialized, 'utf8') * 2 + ENVELOPE_BYTES;
}

export interface OversizeNotice {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

/**
 * `null` when the payload fits, or the refusal to return in its place.
 *
 * Returns the ERROR branch of the result union rather than a smaller payload,
 * deliberately. Each tool declares an output schema, and a "sorry, too big"
 * object is not an instance of it — so a truncated stand-in would either
 * violate the schema or, worse, validate as a legitimate empty result and read
 * to the model as "nothing found".
 */
export function oversizeNotice(payload: unknown, toolName: string, limitBytes: number): OversizeNotice | null {
  const bytes = wireBytes(payload);
  if (bytes <= limitBytes) return null;

  return {
    content: [
      {
        type: 'text' as const,
        text:
          `This ${toolName} result is ~${(bytes / 1_000_000).toFixed(2)} MB on the wire ` +
          `(the payload is sent twice), over the ${(limitBytes / 1_000_000).toFixed(2)} MB limit. ` +
          shrinkHint(toolName),
      },
    ],
    isError: true as const,
  };
}
