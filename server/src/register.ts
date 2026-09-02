import type { Core } from '@strapi/strapi';
import { actionDefinitionForTool, actionForTool, PLUGIN_NAME } from './lib/tool-permissions';

/** Tools whose permissions this plugin owns. Keep in step with bootstrap. */
const TOOL_NAMES = ['list_content_types'];

/**
 * Warn when an action exists but nothing has been granted it.
 *
 * This is the single most confusing failure in this whole subsystem: a tool
 * registers successfully, reports itself registered, and then never appears in
 * `tools/list` — because Strapi enables a capability per session only if the
 * caller's ability satisfies its policy, and an ungranted action satisfies
 * nothing. There is no error on either side. Advisory only: never throw, since
 * a fresh install legitimately has nothing granted yet.
 */
async function warnIfNothingGranted(strapi: Core.Strapi, actions: string[]): Promise<void> {
  try {
    const granted = await strapi.db.query('admin::permission').count({
      where: { action: { $in: actions } },
    });
    if (granted === 0) {
      strapi.log.warn(
        `[${PLUGIN_NAME}] none of this plugin's ${actions.length} tool permission(s) are granted ` +
          'to any role or admin token, so its MCP tools will not appear in tools/list. ' +
          'Grant them in Settings → Roles, or on the admin API token used by your MCP client.',
      );
    }
  } catch (error) {
    // An advisory check must never affect boot.
    strapi.log.debug(
      `[${PLUGIN_NAME}] could not check whether tool permissions are granted: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

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
