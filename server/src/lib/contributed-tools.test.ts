import { describe, expect, it, vi } from 'vitest';
import type { Core } from '@strapi/strapi';
import { discoverContributedTools } from './contributed-tools';

/**
 * Discovery of tools contributed by OTHER plugins.
 *
 * The contract is the reference plugin's, so a plugin written for it works
 * here unmodified — `strapi-plugin-youtube-transcripts` from npm is the live
 * proof. These tests pin the parts that decide whether a badly-behaved plugin
 * can hurt the ones around it.
 */

const validTool = (name: string) => ({
  name,
  description: `does ${name}`,
  schema: { parse: () => ({}) },
  execute: async () => ({ ok: true }),
});

/**
 * A Strapi whose action provider knows about `registered` action ids.
 *
 * Every contributed tool now has to be gated by an action its OWN plugin
 * registered, so the fake has to model that registry — without it, discovery
 * correctly withholds everything and the tests would be asserting on an empty
 * list while appearing to pass for the wrong reason.
 */
function fakeStrapi(
  plugins: Record<string, unknown>,
  registered: string[] = [],
  /** Services the APP exposes, keyed by uid, plus the uids listed in config. */
  app: { services?: Record<string, unknown>; toolSources?: string[] } = {},
) {
  const warn = vi.fn();
  const known = new Set(registered);
  const strapi = {
    plugins,
    plugin: (name: string) => plugins[name],
    config: {
      get: (key: string) =>
        key === 'plugin::tanstack-ai'
          ? { chat: { toolSources: app.toolSources ?? [] }, mcp: {} }
          : undefined,
    },
    service: (name: string) =>
      name === 'admin::permission'
        ? { actionProvider: { get: (id: string) => (known.has(id) ? { actionId: id } : undefined) } }
        : app.services?.[name],
    log: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;
  return { strapi, warn };
}

/** The action a plugin is expected to have registered for one of its tools. */
const actionFor = (plugin: string, slug: string) => `plugin::${plugin}.tool.${slug}`;

const contributor = (tools: unknown[], meta?: unknown) => ({
  service: (name: string) =>
    name === 'ai-tools'
      ? { getTools: () => tools, ...(meta ? { getMeta: () => meta } : {}) }
      : undefined,
});

describe('discoverContributedTools', () => {
  it('finds tools behind an ai-tools service and namespaces them', () => {
    // The namespace is what stops a second plugin's `search` shadowing the
    // first's — and `__` because single underscores already appear in names.
    const { strapi } = fakeStrapi(
      {
        'youtube-transcripts': contributor([validTool('listTranscripts')], {
          label: 'YouTube Transcripts',
          description: 'video transcripts',
        }),
      },
      [actionFor('youtube-transcripts', 'list-transcripts')],
    );
    const [source] = discoverContributedTools(strapi);
    expect(source.id).toBe('youtube-transcripts');
    expect(source.label).toBe('YouTube Transcripts');
    expect(source.tools[0].namespacedName).toBe('youtube-transcripts__listTranscripts');
  });

  it('ignores plugins with no ai-tools service', () => {
    const { strapi } = fakeStrapi({ 'some-plugin': { service: () => {} } });
    expect(discoverContributedTools(strapi)).toEqual([]);
  });

  it('never discovers itself', () => {
    // It would namespace its own tools and offer them twice.
    const { strapi } = fakeStrapi({ 'tanstack-ai': contributor([validTool('x')]) });
    expect(discoverContributedTools(strapi)).toEqual([]);
  });

  it('falls back to the plugin name when no meta is given', () => {
    const { strapi } = fakeStrapi({ 'plain-plugin': contributor([validTool('a')]) }, [
      actionFor('plain-plugin', 'a'),
    ]);
    expect(discoverContributedTools(strapi)[0].label).toBe('plain-plugin');
  });

  it('drops a malformed tool but keeps its siblings', () => {
    // A tool with no handler fails deep in the agent loop, where the error
    // names neither the tool nor the plugin that supplied it.
    const { strapi, warn } = fakeStrapi(
      { p: contributor([{ name: 'broken', description: 'x', schema: {} }, validTool('good')]) },
      [actionFor('p', 'good')],
    );
    const [source] = discoverContributedTools(strapi);
    expect(source.tools.map((t) => t.tool.name)).toEqual(['good']);
    expect(warn).toHaveBeenCalled();
  });

  it('survives a plugin whose service throws', () => {
    // One badly-behaved plugin must not stop the others being found, and must
    // certainly not take out the chat.
    const { strapi, warn } = fakeStrapi(
      {
        bad: {
          service: () => {
            throw new Error('boom');
          },
        },
        good: contributor([validTool('a')]),
      },
      [actionFor('good', 'a')],
    );
    expect(discoverContributedTools(strapi).map((s) => s.id)).toEqual(['good']);
    expect(warn).not.toHaveBeenCalled(); // resolve() swallows; discovery continues
  });

  it('warns and skips when getTools does not return an array', () => {
    const { strapi, warn } = fakeStrapi({
      p: { service: () => ({ getTools: () => 'nonsense' }) },
    });
    expect(discoverContributedTools(strapi)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('skips a duplicate namespaced name rather than shadowing', () => {
    const { strapi, warn } = fakeStrapi({ p: contributor([validTool('same'), validTool('same')]) }, [
      actionFor('p', 'same'),
    ]);
    expect(discoverContributedTools(strapi)[0].tools).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('sanitises a plugin id that is not tool-name safe', () => {
    // Tool names may only contain [a-zA-Z0-9_-]; plugin ids are not so limited.
    const { strapi } = fakeStrapi({ 'weird.name!': contributor([validTool('a')]) }, [
      actionFor('weird.name!', 'a'),
    ]);
    expect(discoverContributedTools(strapi)[0].tools[0].namespacedName).toBe('weird_name___a');
  });
});

describe('buildContributedTools', () => {
  // Imported lazily: it loads the ESM SDK, which the discovery tests above do
  // not need.
  const build = async (strapi: Core.Strapi, enabledSources?: string[]) => {
    const { buildContributedTools } = await import('./contributed-tools');
    const tools = await buildContributedTools(
      strapi,
      enabledSources ? { enabledSources } : undefined,
    );
    return tools.map((tool) => (tool as { name?: string }).name);
  };

  const twoPlugins = () =>
    fakeStrapi(
      { alpha: contributor([validTool('one')]), beta: contributor([validTool('two')]) },
      [actionFor('alpha', 'one'), actionFor('beta', 'two')],
    ).strapi;

  it('offers every source when none is stated', async () => {
    // `undefined` means "the panel has not said", not "none" — sending none
    // while the picker is still loading would strip every contributed tool
    // from the first message of a session.
    expect(await build(twoPlugins())).toEqual(['alpha__one', 'beta__two']);
  });

  it('offers only the enabled sources', async () => {
    expect(await build(twoPlugins(), ['beta'])).toEqual(['beta__two']);
  });

  it('offers nothing when the user has switched everything off', async () => {
    // An empty array is a real choice and is respected, unlike undefined.
    expect(await build(twoPlugins(), [])).toEqual([]);
  });
});


/**
 * Tools contributed by the APPLICATION, not by a plugin.
 *
 * Strapi's MCP server already accepts a tool registered in `src/index.ts`, so
 * a project can put a one-off tool on /mcp without scaffolding a plugin. The
 * chat could not see those, which made the split an implementation detail
 * rather than a decision. A project now names the services it wants offered:
 *
 *   chat: { toolSources: ['api::healthcheck.healthcheck'] }
 *
 * Listed EXPLICITLY, never scanned: "why is this tool in my chat?" has to have
 * an answer that is visible in config.
 */
describe('discoverContributedTools, app-level sources', () => {
  const appService = (tools: unknown[], meta?: unknown) => ({
    getTools: () => tools,
    ...(meta ? { getMeta: () => meta } : {}),
  });

  it('offers tools from a service the project listed', () => {
    const { strapi } = fakeStrapi({}, ['api::healthcheck.run'], {
      toolSources: ['api::healthcheck.healthcheck'],
      services: {
        'api::healthcheck.healthcheck': appService(
          [{ ...validTool('healthcheck'), action: 'api::healthcheck.run' }],
          { label: 'Healthcheck' },
        ),
      },
    });

    const sources = discoverContributedTools(strapi);
    expect(sources).toHaveLength(1);
    expect(sources[0].label).toBe('Healthcheck');
    expect(sources[0].tools.map((t) => t.namespacedName)).toEqual(['healthcheck__healthcheck']);
    expect(sources[0].tools[0].actionId).toBe('api::healthcheck.run');
  });

  it('offers nothing when the project listed nothing', () => {
    const { strapi } = fakeStrapi({}, ['api::healthcheck.run'], {
      services: {
        'api::healthcheck.healthcheck': appService([
          { ...validTool('healthcheck'), action: 'api::healthcheck.run' },
        ]),
      },
    });

    expect(discoverContributedTools(strapi)).toEqual([]);
  });

  it('warns and skips a listed service that is missing or not a tool source', () => {
    const { strapi, warn } = fakeStrapi({}, [], {
      toolSources: ['api::nope.nope'],
      services: {},
    });

    expect(discoverContributedTools(strapi)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('api::nope.nope'));
  });

  it('withholds a tool whose declared action was never registered', () => {
    const { strapi } = fakeStrapi({}, [], {
      toolSources: ['api::healthcheck.healthcheck'],
      services: {
        'api::healthcheck.healthcheck': appService([
          { ...validTool('healthcheck'), action: 'api::healthcheck.run' },
        ]),
      },
    });

    expect(discoverContributedTools(strapi)).toEqual([]);
  });
});
