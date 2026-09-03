import { z } from '@strapi/utils';

/**
 * The contract for what lives in a conversation's `messages` field.
 *
 * Ported from the reference plugin's `lib/stored-messages.ts`, for the reason
 * its header gives: that field is `"type": "json"`, so Strapi stores whatever
 * it is handed and validates NOTHING. Without a schema here the stored shape
 * is implicit — whatever the admin panel's message type happened to be when
 * the row was written — and a malformed client silently corrupts history that
 * nothing can read back.
 *
 * Three decisions carried over verbatim:
 *
 *   1. A VERSIONED ENVELOPE (`{ v, messages }`), so a future change to the
 *      message shape can be detected instead of guessed at.
 *   2. UNKNOWN PART TYPES ARE PRESERVED, not rejected. A part this version
 *      does not understand is still worth keeping; dropping it would quietly
 *      damage the conversation for a version that does.
 *   3. READS ARE TOTAL. A row that cannot be parsed returns empty rather than
 *      throwing, because a corrupt conversation should cost the user that
 *      conversation, not the ability to open the page. The caller logs it, so
 *      it is visible rather than swallowed.
 *
 * WHAT IS DIFFERENT HERE: the part shapes. The reference stores the AI SDK's
 * `UIMessage`, whose text parts are `{ type: 'text', text }` and whose tool
 * calls are a single `tool-<name>` part carrying both input and output.
 * TanStack AI uses `{ type: 'text', content }`, and splits a tool invocation
 * into `tool-call` and a later `tool-result`. Storing what the SDK actually
 * emits keeps the round-trip lossless and avoids a translation layer, which is
 * exactly the reasoning the reference gives for storing UIMessage in the first
 * place.
 *
 * There is no legacy format to migrate: this plugin has never shipped a
 * different one. The envelope exists so that the next change has somewhere to
 * stand.
 */

export const STORAGE_VERSION = 1;

/** A text segment of a user or assistant turn. */
const textPartSchema = z.object({
  type: z.literal('text'),
  content: z.string(),
});

/** Reasoning, when the model emits it. */
const thinkingPartSchema = z.looseObject({
  type: z.literal('thinking'),
  content: z.string(),
});

/**
 * A tool invocation, and — as a separate part — its result.
 *
 * Loose, because the SDK carries per-tool fields (`arguments`, `input`,
 * `approval`) that this module has no reason to enumerate and every reason not
 * to drop.
 */
const toolCallPartSchema = z.looseObject({
  type: z.literal('tool-call'),
  id: z.string(),
  name: z.string(),
});

const toolResultPartSchema = z.looseObject({
  type: z.literal('tool-result'),
  toolCallId: z.string(),
});

/**
 * Anything else the SDK emits now or later — images, documents, structured
 * output, UI resources. Preserved verbatim.
 */
const unknownPartSchema = z.looseObject({ type: z.string() });

const partSchema = z.union([
  textPartSchema,
  thinkingPartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  unknownPartSchema,
]);

export const uiMessageSchema = z.looseObject({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(partSchema),
});

export type StoredUIMessage = z.infer<typeof uiMessageSchema>;

/** The versioned envelope written to the `messages` field. */
export const storedMessagesSchema = z.object({
  v: z.literal(STORAGE_VERSION),
  messages: z.array(uiMessageSchema),
});

export type StoredMessages = z.infer<typeof storedMessagesSchema>;

/**
 * Read whatever is in the database and return current-version messages.
 *
 * Deliberately total — see the header. `error` is set rather than thrown so
 * the caller can log which conversation is damaged.
 */
export function readStoredMessages(raw: unknown): {
  messages: StoredUIMessage[];
  error?: string;
} {
  if (raw === null || raw === undefined) return { messages: [] };

  const current = storedMessagesSchema.safeParse(raw);
  if (current.success) return { messages: current.data.messages };

  // A bare array, in case something wrote messages without the envelope.
  const bare = z.array(uiMessageSchema).safeParse(raw);
  if (bare.success) return { messages: bare.data };

  return {
    messages: [],
    error: `unrecognised shape: ${current.error.issues[0]?.message ?? 'unknown'}`,
  };
}

/**
 * NOT a discriminated union, and that is not a style choice.
 *
 * Strapi's server tsconfig sets `strict: false`, which disables
 * `strictNullChecks`, and without it TypeScript will not narrow
 * `{ ok: true } | { ok: false }` on an `if (!result.ok)` check — every call
 * site would report the other branch's fields as missing. Optional fields on
 * one interface behave correctly under these compiler settings. (Verified: the
 * base config this plugin extends,
 * `@strapi/typescript-utils/tsconfigs/server`, sets `"strict": false`.)
 */
export interface ToStoredResult {
  ok: boolean;
  value?: StoredMessages;
  error?: string;
}

/** Validate an incoming payload and wrap it for storage. */
export function toStoredMessages(input: unknown): ToStoredResult {
  const envelope = storedMessagesSchema.safeParse(input);
  if (envelope.success) return { ok: true, value: envelope.data };

  const bare = z.array(uiMessageSchema).safeParse(input);
  if (bare.success) return { ok: true, value: { v: STORAGE_VERSION, messages: bare.data } };

  const issue = bare.error.issues[0];
  return {
    ok: false,
    error: issue
      ? `${issue.path.join('.') || 'messages'}: ${issue.message}`
      : 'invalid messages payload',
  };
}
