import type { Core } from '@strapi/strapi';
import { loadAI } from './tanstack-ai';

/**
 * Tools contributed by OTHER Strapi plugins.
 *
 * Ported from the reference plugin's `discoverPluginTools` in bootstrap.ts,
 * including the contract itself, so a plugin written for the reference works
 * here unmodified: a contributing plugin exposes a service named `ai-tools`
 * with
 *
 *   getTools(): Array<{ name, description, schema (zod), execute(args, strapi, context) }>
 *   getMeta?(): { label, description, keywords? }
 *
 * and registers nothing. Discovery is the host's job, which is what lets a
 * plugin like `strapi-plugin-youtube-transcripts` be installed from npm and
 * contribute without knowing anything about this one.
 *
 * NAMESPACED `<source>__<tool>`, and the separator is two underscores because
 * tool names are limited to [a-zA-Z0-9_-] and single underscores already
 * appear inside tool names (`list_transcripts`). Namespacing is what stops a
 * second plugin's `search` from silently shadowing the first's.
 */

/** What a contributing plugin's `ai-tools` service returns. */
interface ContributedTool {
  name: string;
  description: string;
  schema: unknown;
  execute: (args: unknown, strapi: Core.Strapi, context?: unknown) => Promise<unknown>;
  /** Chat-only. Kept for compatibility with the reference's contract. */
  internal?: boolean;
}

interface ToolSourceMeta {
  label: string;
  description: string;
  keywords?: string[];
}

export interface DiscoveredSource {
  /** Namespace prefix, e.g. `youtube_transcripts`. */
  id: string;
  /** The Strapi plugin it came from. */
  pluginName: string;
  label: string;
  description: string;
  tools: Array<{ namespacedName: string; tool: ContributedTool }>;
}

/** Tool names may only contain [a-zA-Z0-9_-]; plugin ids may contain more. */
const safeSourceId = (pluginName: string): string => pluginName.replace(/[^a-zA-Z0-9_-]/g, '_');

function resolveAiToolsService(strapi: Core.Strapi, pluginName: string): { getTools?: () => unknown; getMeta?: () => unknown } | null {
  try {
    const service = strapi.plugin(pluginName)?.service?.('ai-tools' as never);
    if (service) return service as never;
  } catch {
    // A plugin whose service registry throws is not a contributor.
  }
  return null;
}

/**
 * Every plugin offering an `ai-tools` service, with its tools namespaced.
 *
 * Never throws: one badly-behaved plugin must not stop the others being
 * discovered, and must certainly not take out the chat.
 */
export function discoverContributedTools(strapi: Core.Strapi): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const seen = new Set<string>();

  for (const pluginName of Object.keys(strapi.plugins ?? {})) {
    if (pluginName === 'tanstack-ai') continue;

    try {
      const service = resolveAiToolsService(strapi, pluginName);
      if (!service?.getTools) continue;

      const contributed = service.getTools();
      if (!Array.isArray(contributed)) {
        strapi.log.warn(`[tanstack-ai] ${pluginName}.ai-tools.getTools() did not return an array`);
        continue;
      }

      const id = safeSourceId(pluginName);
      const tools: DiscoveredSource['tools'] = [];

      for (const tool of contributed as ContributedTool[]) {
        // Validated rather than trusted: these objects come from another
        // package, and a tool missing its schema or handler would fail deep
        // inside the agent loop where the message names neither the tool nor
        // the plugin that supplied it.
        if (!tool?.name || typeof tool.execute !== 'function' || !tool.schema) {
          strapi.log.warn(
            `[tanstack-ai] ignoring invalid tool "${tool?.name ?? 'unnamed'}" from ${pluginName}`,
          );
          continue;
        }

        const namespacedName = `${id}__${tool.name}`;
        if (seen.has(namespacedName)) {
          strapi.log.warn(`[tanstack-ai] duplicate contributed tool ${namespacedName}, skipping`);
          continue;
        }
        seen.add(namespacedName);
        tools.push({ namespacedName, tool });
      }

      if (tools.length === 0) continue;

      const meta = (typeof service.getMeta === 'function' ? service.getMeta() : null) as
        | ToolSourceMeta
        | null;

      sources.push({
        id,
        pluginName,
        label: meta?.label ?? pluginName,
        description: meta?.description ?? '',
        tools,
      });

      strapi.log.info(
        `[tanstack-ai] discovered ${tools.length} tool(s) from plugin "${pluginName}"`,
      );
    } catch (error) {
      strapi.log.warn(
        `[tanstack-ai] tool discovery failed for ${pluginName}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  return sources;
}

/**
 * Contributed tools as TanStack AI tools, filtered to the enabled sources.
 *
 * `enabledSources === undefined` means "not yet known" — the panel has not
 * reported its selection — and everything is offered. An empty ARRAY means the
 * user turned everything off, which is a different thing and is respected.
 */
export async function buildContributedTools(
  strapi: Core.Strapi,
  options?: { enabledSources?: string[] },
) {
  const { toolDefinition } = await loadAI();
  const enabled = options?.enabledSources;
  const tools = [];

  for (const source of discoverContributedTools(strapi)) {
    if (enabled && !enabled.includes(source.id)) continue;

    for (const { namespacedName, tool } of source.tools) {
      const definition = toolDefinition({
        name: namespacedName,
        // The source is named in the description so the model can attribute an
        // answer to it, and so two similarly-named tools are distinguishable.
        description: `[${source.label}] ${tool.description}`,
        inputSchema: tool.schema as never,
      });

      const handler = (async (args: unknown) => {
        // The contributed contract passes `strapi` explicitly and a context
        // object third — matching the reference, so a plugin written for it
        // runs here unchanged.
        return tool.execute(args, strapi, {});
      }) as never;

      tools.push(definition.server(handler));
    }
  }

  return tools;
}
