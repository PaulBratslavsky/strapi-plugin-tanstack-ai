import type { Core } from '@strapi/strapi';
import { loadAI } from './tanstack-ai';
import { readConfig } from './plugin-config';
import { actionForContributedTool, canRegisterAction, PLUGIN_NAME } from './tool-permissions';

/**
 * Tools contributed by OTHER Strapi plugins.
 *
 * A contributing plugin exposes a service named `ai-tools`:
 *
 *   getTools(): Array<{ name, description, schema (zod), execute(args, strapi, context), action? }>
 *   getMeta?(): { label, description, keywords? }
 *
 * EACH PLUGIN IS STANDALONE AND OWNS ITS OWN PERMISSIONS. The contributing
 * plugin registers its tools' admin actions under its own `plugin::<id>.*`
 * namespace; this one only ever READS them. That is what keeps the two
 * independent — the contributor's tools are gated whether or not any chat host
 * is installed, and because each plugin registers only in its own namespace,
 * Strapi's `throwOnDuplicates` action provider can never see the same id twice.
 *
 * This is where the design departs from the reference plugin, which registers
 * actions on contributors' behalf. That works, but it makes the contributor's
 * permissions exist only while a host is installed, and it means two hosts
 * cannot coexist — the second to register throws `Duplicated item key` and
 * loses its whole batch.
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
  /**
   * The admin permission action that gates this tool, as registered by the
   * plugin that owns it — e.g.
   * `plugin::youtube-transcripts.tool.fetch-transcript`.
   *
   * DECLARED, not derived, is the supported form: an id this plugin guessed
   * from a naming convention is a guess about someone else's choices, and when
   * it guesses wrong the tool silently disappears with no error anywhere.
   */
  action?: string;
}

interface ToolSourceMeta {
  label: string;
  description: string;
  keywords?: string[];
}

export interface DiscoveredTool {
  namespacedName: string;
  tool: ContributedTool;
  /**
   * The admin permission action gating this tool, owned by the CONTRIBUTING
   * plugin — `plugin::youtube-transcripts.tool.fetch-transcript`, not
   * `plugin::tanstack-ai...`. Its checkbox therefore appears in that plugin's
   * own section of the permissions grid, which is where someone looking for
   * "YouTube Transcripts" will look.
   */
  actionId: string;
}

export interface DiscoveredSource {
  /** Namespace prefix, e.g. `youtube-transcripts`. */
  id: string;
  /**
   * Where the tools came from: a plugin id, or a service uid for a source the
   * project listed in `chat.toolSources`.
   */
  pluginName: string;
  label: string;
  description: string;
  tools: DiscoveredTool[];
}

/** Tool names may only contain [a-zA-Z0-9_-]; plugin ids may contain more. */
const safeSourceId = (pluginName: string): string => pluginName.replaceAll(/[^\w-]/g, '_');

/**
 * Has the owning plugin actually registered this action?
 *
 * The check that turns a silent failure into a log line. Without it a tool
 * whose action was never registered is gated on an id that can never be
 * granted, so it vanishes from the chat for everyone — Super Admin included —
 * with nothing anywhere saying why.
 */
function actionExists(strapi: Core.Strapi, actionId: string): boolean {
  try {
    return Boolean(strapi.service('admin::permission')?.actionProvider?.get(actionId));
  } catch {
    // No provider (or a host shape we do not recognise): fail closed.
    return false;
  }
}

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
 * Is this object shaped like a tool at all?
 *
 * Validated rather than trusted: these come from another package, and a tool
 * missing its schema or handler would fail deep inside the agent loop, where
 * the message names neither the tool nor the plugin that supplied it.
 */
function isUsableTool(strapi: Core.Strapi, pluginName: string, tool: ContributedTool): boolean {
  if (tool?.name && typeof tool.execute === 'function' && tool.schema) return true;
  strapi.log.warn(
    `[tanstack-ai] ignoring invalid tool "${tool?.name ?? 'unnamed'}" from ${pluginName}`,
  );
  return false;
}

/**
 * The action gating this tool, or null if there is none to gate it with.
 *
 * A declared id wins. Deriving one is a guess about another plugin's naming,
 * so a derived id is only accepted once the action provider confirms the
 * owning plugin really registered it.
 */
function resolveActionId(
  strapi: Core.Strapi,
  pluginName: string,
  tool: ContributedTool,
): string | null {
  let actionId: string | null = null;
  if (typeof tool.action === 'string' && tool.action.length > 0) {
    actionId = tool.action;
  } else if (canRegisterAction(tool.name)) {
    actionId = actionForContributedTool(pluginName, tool.name);
  }

  if (actionId && actionExists(strapi, actionId)) return actionId;

  // WITHHELD, not offered ungated. A tool with no registered action cannot be
  // granted to anyone, so offering it would put it outside the permission
  // system entirely — the opposite of what the grid implies. Named loudly,
  // because the fix belongs in the OTHER plugin and nothing else would say so.
  const reason = actionId
    ? `no admin permission action "${actionId}" is registered. `
    : 'it declares no permission action and none can be derived from its name. ';
  strapi.log.warn(
    `[tanstack-ai] not offering "${tool.name}" from "${pluginName}": ${reason}` +
      `"${pluginName}" must register its own action for this tool — this plugin does not ` +
      "register permissions on another plugin's behalf.",
  );
  return null;
}

/** One plugin's tools: validated, gated, namespaced and de-duplicated. */
function collectTools(
  strapi: Core.Strapi,
  pluginName: string,
  sourceId: string,
  contributed: ContributedTool[],
  seen: Set<string>,
): DiscoveredTool[] {
  const tools: DiscoveredTool[] = [];

  for (const tool of contributed) {
    if (!isUsableTool(strapi, pluginName, tool)) continue;

    const actionId = resolveActionId(strapi, pluginName, tool);
    if (!actionId) continue;

    const namespacedName = `${sourceId}__${tool.name}`;
    if (seen.has(namespacedName)) {
      strapi.log.warn(`[tanstack-ai] duplicate contributed tool ${namespacedName}, skipping`);
      continue;
    }

    seen.add(namespacedName);
    tools.push({ namespacedName, tool, actionId });
  }

  return tools;
}

/** What one plugin contributes, or null if it contributes nothing usable. */
function discoverFromPlugin(
  strapi: Core.Strapi,
  pluginName: string,
  seen: Set<string>,
): DiscoveredSource | null {
  const service = resolveAiToolsService(strapi, pluginName);
  if (!service?.getTools) return null;

  const contributed = service.getTools();
  if (!Array.isArray(contributed)) {
    strapi.log.warn(`[tanstack-ai] ${pluginName}.ai-tools.getTools() did not return an array`);
    return null;
  }

  const sourceId = safeSourceId(pluginName);
  const tools = collectTools(strapi, pluginName, sourceId, contributed, seen);
  if (tools.length === 0) return null;

  const meta = (typeof service.getMeta === 'function' ? service.getMeta() : null) as
    | ToolSourceMeta
    | null;

  strapi.log.info(`[tanstack-ai] discovered ${tools.length} tool(s) from plugin "${pluginName}"`);

  return {
    id: sourceId,
    pluginName,
    label: meta?.label ?? pluginName,
    description: meta?.description ?? '',
    tools,
  };
}

/**
 * Every plugin offering an `ai-tools` service, with its tools namespaced.
 *
 * NO SINGLE PLUGIN CAN STOP THE OTHERS BEING DISCOVERED. Each plugin's whole
 * inspection is wrapped in its own try/catch, so a contributor that throws
 * from `getTools()`, returns nonsense, or blows up in its service registry is
 * logged and skipped while the rest are still found. (The claim is that, not
 * "never throws" — the `Object.keys` below and the logger inside the catch sit
 * outside the guard.)
 *
 * `getTools()` MUST BE SYNCHRONOUS. Its result is checked with `Array.isArray`,
 * so a plugin returning a promise is rejected as "did not return an array" — a
 * message that points at the wrong thing. Worth knowing before writing a
 * contributor that wants to load its tools lazily.
 *
 * Called per request rather than cached at boot, so a plugin can be enabled or
 * disabled without restarting this one. That puts another plugin's `getTools()`
 * on the hot path of every message, which is fine for the static arrays
 * contributors return today and worth revisiting if one ever does real work
 * there.
 */
export function discoverContributedTools(strapi: Core.Strapi): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const seen = new Set<string>();

  const plugins = Object.keys(strapi.plugins ?? {}).filter((name) => name !== PLUGIN_NAME);
  for (const pluginName of plugins) {
    const source = guarded(strapi, pluginName, () => discoverFromPlugin(strapi, pluginName, seen));
    if (source) sources.push(source);
  }

  for (const uid of appToolSources(strapi)) {
    const source = guarded(strapi, uid, () => discoverFromAppService(strapi, uid, seen));
    if (source) sources.push(source);
  }

  return sources;
}

/**
 * One source's whole inspection, so a contributor that throws is logged and
 * skipped while the rest are still found.
 */
function guarded(
  strapi: Core.Strapi,
  sourceName: string,
  discover: () => DiscoveredSource | null,
): DiscoveredSource | null {
  try {
    return discover();
  } catch (error) {
    strapi.log.warn(
      `[tanstack-ai] tool discovery failed for ${sourceName}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return null;
  }
}

/**
 * Service uids the PROJECT listed in `chat.toolSources`.
 *
 * Listed, never scanned. Strapi's MCP server already takes a tool registered
 * in the app's `src/index.ts`, so a project can put a one-off tool on /mcp
 * without scaffolding a plugin; this is how the same tool reaches the chat.
 * Scanning for a conventional service name instead would make "why is this
 * tool in my chat?" unanswerable from the config.
 */
function appToolSources(strapi: Core.Strapi): string[] {
  try {
    const listed = readConfig(strapi).chat.toolSources;
    return Array.isArray(listed) ? listed.filter((uid) => typeof uid === 'string') : [];
  } catch {
    // No config (or a shape we do not recognise): contribute nothing.
    return [];
  }
}

/**
 * One app-level source: a service exposing the same `ai-tools` contract.
 *
 * The namespace is the uid's own name — `api::healthcheck.healthcheck` becomes
 * `healthcheck` — so tools read as `healthcheck__<tool>`, the same shape a
 * plugin's tools get.
 */
function discoverFromAppService(
  strapi: Core.Strapi,
  uid: string,
  seen: Set<string>,
): DiscoveredSource | null {
  const service = strapi.service(uid as never) as
    | { getTools?: () => unknown; getMeta?: () => unknown }
    | undefined;

  if (typeof service?.getTools !== 'function') {
    // Named in config but not usable: always worth a line, because the project
    // asked for it explicitly and would otherwise see silence.
    strapi.log.warn(
      `[tanstack-ai] chat.toolSources lists "${uid}", which has no getTools() — skipped`,
    );
    return null;
  }

  const contributed = service.getTools();
  if (!Array.isArray(contributed)) {
    strapi.log.warn(`[tanstack-ai] ${uid}.getTools() did not return an array`);
    return null;
  }

  const sourceId = safeSourceId(uid.split('::').pop()?.split('.', 1)[0] ?? uid);
  const tools = collectTools(strapi, uid, sourceId, contributed, seen);
  if (tools.length === 0) return null;

  const meta = (typeof service.getMeta === 'function' ? service.getMeta() : null) as
    | ToolSourceMeta
    | null;

  strapi.log.info(`[tanstack-ai] discovered ${tools.length} tool(s) from "${uid}"`);

  return {
    id: sourceId,
    pluginName: uid,
    label: meta?.label ?? sourceId,
    description: meta?.description ?? '',
    tools,
  };
}

/** One contributed tool, wrapped as a TanStack AI tool. */
function buildTool(
  strapi: Core.Strapi,
  toolDefinition: Awaited<ReturnType<typeof loadAI>>['toolDefinition'],
  sourceLabel: string,
  namespacedName: string,
  tool: ContributedTool,
) {
  const definition = toolDefinition({
    name: namespacedName,
    // The source is named in the description so the model can attribute an
    // answer to it, and so two similarly-named tools are distinguishable.
    description: `[${sourceLabel}] ${tool.description}`,
    inputSchema: tool.schema as never,
  });

  const handler = (async (args: unknown) => {
    // The contributed contract passes `strapi` explicitly and a context object
    // third — matching the reference, so a plugin written for it runs here
    // unchanged.
    return tool.execute(args, strapi, {});
  }) as never;

  return definition.server(handler);
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
  options?: { enabledSources?: string[]; ability?: { can: (action: string) => boolean } },
) {
  const { toolDefinition } = await loadAI();
  const enabled = options?.enabledSources;
  const ability = options?.ability;
  const tools = [];

  for (const source of discoverContributedTools(strapi)) {
    if (enabled && !enabled.includes(source.id)) continue;

    /*
     * TWO INDEPENDENT AXES, and both must pass.
     *
     * `enabledToolSources` above is a PREFERENCE — a per-person browser toggle
     * for keeping the tool list focused. The filter below is PERMISSION, and
     * it is the same check that gates this plugin's own tools, just reading
     * the contributing plugin's grant instead of ours. A source switched on by
     * someone whose role lacks the grant still gets nothing.
     */
    const permitted = source.tools.filter(({ namespacedName, actionId }) => {
      if (!ability || ability.can(actionId)) return true;
      strapi.log.debug(`[tanstack-ai] withholding ${namespacedName} — caller lacks ${actionId}`);
      return false;
    });

    for (const { namespacedName, tool } of permitted) {
      tools.push(buildTool(strapi, toolDefinition, source.label, namespacedName, tool));
    }
  }

  return tools;
}
