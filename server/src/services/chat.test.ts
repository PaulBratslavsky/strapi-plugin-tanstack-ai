import { describe, expect, it, vi } from 'vitest';
import type { Core } from '@strapi/strapi';
import { buildPreamble } from './chat';

// buildPreamble's collaborators are mocked so the test measures only how the
// prompt is composed. buildChatTools is kept REAL in the second describe.
// vi.mock is hoisted above the static import of ./chat, so the mocks apply.
vi.mock('../lib/memory-tools', () => ({ buildMemoryTools: async () => [], memoryPreamble: async () => '' }));
vi.mock('../lib/note-tools', () => ({ buildNoteTools: async () => [] }));
vi.mock('../lib/contributed-tools', () => ({ buildContributedTools: async () => [] }));
vi.mock('../lib/tanstack-ai', () => ({
  loadAI: async () => ({ toolDefinition: (def: { name: string }) => ({ server: () => ({ name: def.name }) }) }),
}));

const strapiWith = (systemPrompt?: string) =>
  ({
    config: { get: () => ({ chat: { systemPrompt }, mcp: {} }) },
    log: { debug: vi.fn() },
  }) as unknown as Core.Strapi;

describe('buildPreamble system prompt', () => {
  it('starts with the configured chat.systemPrompt', async () => {
    const { system } = await buildPreamble(strapiWith('You help the Strapi blog team.'), { ability: { can: () => false } });
    expect(system?.startsWith('You help the Strapi blog team.')).toBe(true);
  });

  it('lets a per-request system prompt override the configured one', async () => {
    const { system } = await buildPreamble(strapiWith('configured'), { system: 'from request', ability: { can: () => false } });
    expect(system).toContain('from request');
    expect(system).not.toContain('configured');
  });

  it('works with no prompt configured, as before', async () => {
    const { system } = await buildPreamble(strapiWith(undefined), { ability: { can: () => false } });
    expect(system).toBeUndefined();
  });
});

describe('write tools in the chat', () => {
  it('withholds create_content from an admin whose role lacks its action', async () => {
    // Review Focus 5.
    const { tools } = await buildPreamble(strapiWith(undefined), {
      ability: { can: (action: string) => action !== 'plugin::tanstack-ai.tool.create-content' },
    });
    const names = tools.map((tool) => (tool as { name?: string }).name);
    expect(names).not.toContain('create_content');
    expect(names).toContain('update_content');
  });
});
