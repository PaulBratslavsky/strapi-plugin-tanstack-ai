import { describe, expect, it, vi } from 'vitest';
import type { Core } from '@strapi/strapi';
import { memoryPreamble } from './memory-tools';

/**
 * `memoryPreamble` is the half of the memory feature that decides whether it
 * works at all, so it is tested here rather than through the model.
 *
 * The end-to-end version — ask the model a question only a saved memory can
 * answer — lives in the browser suite behind the `@model` tag. It is a real
 * check and a bad gate: whether a model uses what it was given is its
 * decision, and a test that fails when a local model has an off day reports a
 * problem that is not there.
 */

function fakeStrapi(rows: unknown, opts: { throws?: boolean } = {}) {
  const warn = vi.fn();
  const strapi = {
    documents: () => ({
      findMany: async () => {
        if (opts.throws) throw new Error('database is gone');
        return rows;
      },
    }),
    log: { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;
  return { strapi, warn };
}

describe('memoryPreamble', () => {
  it('lists every memory with its category', async () => {
    const { strapi } = fakeStrapi([
      { content: 'Prefers short answers', category: 'preference' },
      { content: 'Works on the pricing page', category: 'project' },
    ]);
    const preamble = await memoryPreamble(strapi, 1);
    expect(preamble).toContain('- [preference] Prefers short answers');
    expect(preamble).toContain('- [project] Works on the pricing page');
  });

  it('says nothing at all when there are no memories', async () => {
    // An empty section would still spend tokens and, worse, invite the model
    // to comment on having no memories.
    const { strapi } = fakeStrapi([]);
    expect(await memoryPreamble(strapi, 1)).toBe('');
  });

  it('frames them as background rather than as instructions', async () => {
    // Without this the model tends to recite the list back at the user on the
    // next turn, which reads as an assistant with a filing cabinet fixation.
    const { strapi } = fakeStrapi([{ content: 'x', category: 'general' }]);
    expect(await memoryPreamble(strapi, 1)).toMatch(/do not repeat them back/i);
  });

  it('never fails a chat turn because memories could not be read', async () => {
    // An answer without memories is worse than one with. No answer is worse
    // still — so a broken read degrades rather than throws, and warns.
    const { strapi, warn } = fakeStrapi(null, { throws: true });
    expect(await memoryPreamble(strapi, 1)).toBe('');
    expect(warn).toHaveBeenCalled();
  });
});
