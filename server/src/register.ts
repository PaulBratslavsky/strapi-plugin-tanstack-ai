import type { Core } from '@strapi/strapi';
import { actionDefinitionForTool, actionForTool, PLUGIN_NAME } from './lib/tool-permissions';
import { warnIfNothingGranted } from './lib/permission-advisory';
import { toolNames } from './tools';

/**
 * Derived from the registry, never hand-listed.
 *
 * These are the BARE names — a configured `mcp.toolPrefix` changes what MCP
 * clients see, not what an operator granted. Keying actions to the prefixed
 * name would orphan every existing grant the moment the prefix changed.
 */
const TOOL_NAMES = toolNames();

/**
 * Register this plugin's admin permission actions.
 *
 * In REGISTER, not bootstrap: an action must exist before anything can be
 * granted against it, and before the MCP session gate evaluates a policy
 * naming it.
 *
 * One action PER TOOL, rather than a few coarse tiers. Tiers put checkboxes in
 * the admin grid that do not correspond to anything the operator can see,
 * whereas per-tool actions let a token be scoped to exactly the tools it needs
 * — which is the whole point of putting them in RBAC rather than inventing a
 * private allow-list.
 */
const register = async ({ strapi }: { strapi: Core.Strapi }) => {
  const actionProvider = strapi.service('admin::permission')?.actionProvider;
  if (!actionProvider) {
    strapi.log.warn(`[${PLUGIN_NAME}] admin permission provider unavailable — tools will not be grantable`);
    return;
  }

  // AWAITED. registerMany is async, and an action that is not yet in the
  // registry when a token is minted, or when the session gate runs, is
  // indistinguishable from one that was never declared.
  await actionProvider.registerMany(TOOL_NAMES.map(actionDefinitionForTool));
  strapi.log.info(`[${PLUGIN_NAME}] registered ${TOOL_NAMES.length} permission action(s)`);

  await warnIfNothingGranted(strapi, TOOL_NAMES.map(actionForTool));
};

export default register;
