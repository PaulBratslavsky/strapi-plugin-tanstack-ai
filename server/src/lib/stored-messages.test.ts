import { describe, expect, it } from 'vitest';
import { readStoredMessages, toStoredMessages, STORAGE_VERSION } from './stored-messages';

const message = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  role: 'assistant',
  parts: [{ type: 'text', content: 'hi' }],
  ...over,
});

describe('toStoredMessages', () => {
  it('wraps a bare array in the versioned envelope', () => {
    const result = toStoredMessages([message()]);
    expect(result.ok).toBe(true);
    expect(result.value?.v).toBe(STORAGE_VERSION);
  });

  it('accepts an already-enveloped payload unchanged', () => {
    const enveloped = { v: STORAGE_VERSION, messages: [message()] };
    expect(toStoredMessages(enveloped).value).toEqual(enveloped);
  });

  it('rejects a payload that is not messages at all', () => {
    // The whole reason this module exists: `type: json` means Strapi would
    // happily store this and hand back something nothing can render.
    const result = toStoredMessages({ nonsense: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects a message with no role', () => {
    expect(toStoredMessages([{ id: 'x', parts: [] }]).ok).toBe(false);
  });

  it('keeps fields on a part it does not model', () => {
    // A part type this version has never seen must survive the round trip;
    // dropping it silently damages the conversation for a version that
    // understands it.
    const exotic = { id: 'm1', role: 'assistant', parts: [{ type: 'image', url: 'x', alt: 'y' }] };
    const stored = toStoredMessages([exotic]);
    expect(stored.value?.messages[0].parts[0]).toEqual({ type: 'image', url: 'x', alt: 'y' });
  });

  it('keeps the extra fields TanStack puts on a tool call', () => {
    const call = {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'tool-call', id: 'c1', name: 'search_content', arguments: '{}', state: 'complete' },
        { type: 'tool-result', toolCallId: 'c1', content: '{"results":[]}', state: 'complete' },
      ],
    };
    const parts = toStoredMessages([call]).value?.messages[0].parts as Array<Record<string, unknown>>;
    expect(parts[0]).toMatchObject({ name: 'search_content', arguments: '{}', state: 'complete' });
    expect(parts[1]).toMatchObject({ toolCallId: 'c1', content: '{"results":[]}' });
  });
});

describe('readStoredMessages', () => {
  it('reads back what was written', () => {
    const stored = toStoredMessages([message()]).value;
    expect(readStoredMessages(stored).messages).toHaveLength(1);
  });

  it('treats an empty field as an empty conversation', () => {
    expect(readStoredMessages(null).messages).toEqual([]);
    expect(readStoredMessages(undefined).messages).toEqual([]);
  });

  it('reads a bare array written without the envelope', () => {
    expect(readStoredMessages([message()]).messages).toHaveLength(1);
  });

  it('returns empty AND an error for a corrupt row, rather than throwing', () => {
    // A damaged row should cost the user that conversation, not the ability to
    // open the page — and the caller logs the error, so it is visible.
    const result = readStoredMessages({ v: 99, messages: 'not an array' });
    expect(result.messages).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});
