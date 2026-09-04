import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { discoverContributedTools } from '../lib/contributed-tools';
import { ALL_TOOLS } from '../tools';
import { actionForTool } from '../lib/tool-permissions';

/**
 * What tools this chat can reach, and where each one comes from.
 *
 * Ported from the reference plugin's `getToolSources`, including the filter
 * its comment justifies: sources the caller cannot actually use are hidden,
 * because otherwise the picker offers a toggle that appears to do nothing —
 * the tool is withheld again downstream by the same permission check.
 *
 * Sources are returned in two kinds. The built-in group is this plugin's own
 * tools and is NOT toggleable: turning off the content tools would leave a
 * chat panel that cannot answer the questions it exists for. Contributed
 * sources come from other plugins and are each switchable.
 */

const BUILT_IN_ID = 'built-in';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async find(ctx: Context) {
    const ability = ctx.state?.userAbility;

    // The caller's own grants, evaluated with the same per-tool actions that
    // gate MCP — so this list matches what the model will actually be offered.
    const builtInTools = ALL_TOOLS.filter(
      (tool) => !ability || ability.can(actionForTool(tool.name)),
    ).map((tool) => ({ name: tool.name, description: tool.description }));

    const sources = [];

    if (builtInTools.length > 0) {
      sources.push({
        id: BUILT_IN_ID,
        label: 'Strapi content',
        description: "This plugin's own tools, also published over MCP.",
        toggleable: false,
        tools: builtInTools,
      });
    }

    // Memory and notes exist only for a logged-in admin, which every caller
    // here is — they are listed so the picker shows the whole picture rather
    // than only the half that came from somewhere else.
    sources.push({
      id: 'assistant-memory',
      label: 'Memory & notes',
      description: 'Facts and research the assistant keeps for you.',
      toggleable: false,
      tools: [
        { name: 'save_memory', description: 'Remember a fact about you.' },
        { name: 'recall_memories', description: 'Look up remembered facts.' },
        { name: 'save_note', description: 'Save a research note.' },
        { name: 'recall_notes', description: 'Search saved notes.' },
      ],
    });

    for (const source of discoverContributedTools(strapi)) {
      // Filtered by the SAME action the chat gate uses, so the menu shows what
      // the caller can actually reach. Without this the picker offers a toggle
      // that appears to do nothing: switching it on changes a preference, and
      // the permission check then withholds the tool anyway.
      const permitted = source.tools.filter(
        ({ actionId }) => !ability || ability.can(actionId),
      );
      if (permitted.length === 0) continue;

      sources.push({
        id: source.id,
        label: source.label,
        description: source.description,
        toggleable: true,
        tools: permitted.map(({ namespacedName, tool }) => ({
          name: namespacedName,
          description: tool.description,
        })),
      });
    }

    ctx.body = { data: sources };
  },
});
