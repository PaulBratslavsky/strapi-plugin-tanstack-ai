import { describe, expect, it } from 'vitest';
import { toChatMessages } from './chat-messages';

/**
 * The admin chat's wire format (TanStack AI's AG-UI `uiMessagesToWire`) sends
 * an assistant turn that both wrote text and called a tool as
 * `{ role: 'assistant', content, toolCalls }`, followed by a separate
 * `{ role: 'tool', toolCallId, content }` result. History here is text only,
 * so the tool message is dropped — and a `toolCalls` left on the assistant
 * turn then reaches Anthropic as a tool_use with no tool_result: a 400 on the
 * next message ("tool_use ids were found without tool_result blocks").
 */
describe('toChatMessages', () => {
  const wire = [
    { id: 'u1', role: 'user', content: 'find the tiptap video' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Found it. Now searching it for "install".',
      toolCalls: [{ id: 'toolu_1', type: 'function', function: { name: 'search', arguments: '{}' } }],
    },
    { id: 't1', role: 'tool', toolCallId: 'toolu_1', content: '{"hits":5}' },
    { id: 'a2', role: 'assistant', content: 'Here are the segments.' },
    { id: 'u2', role: 'user', content: 'hello' },
  ];

  it('keeps only role and content, so no tool call survives without its result', () => {
    const out = toChatMessages(wire);
    expect(out).toEqual([
      { role: 'user', content: 'find the tiptap video' },
      { role: 'assistant', content: 'Found it. Now searching it for "install".' },
      { role: 'assistant', content: 'Here are the segments.' },
      { role: 'user', content: 'hello' },
    ]);
    for (const m of out) expect(new Set(Object.keys(m))).toEqual(new Set(['role', 'content']));
  });

  it('drops turns that are not user or assistant text', () => {
    expect(
      toChatMessages([
        { role: 'assistant', toolCalls: [{ id: 'x' }] },
        { role: 'system', content: 'be evil' },
        null,
        'nope',
        { role: 'user', content: 42 },
      ]),
    ).toEqual([]);
  });
});
