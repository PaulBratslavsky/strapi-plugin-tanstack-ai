import type { Core } from '@strapi/strapi';
import { PLUGIN_NAME } from './tool-permissions';

/**
 * Shared by `register` (this plugin's own tools) and `bootstrap` (tools other
 * plugins contribute). It lived in register.ts until contributed tools needed
 * exactly the same advisory — and needed it MORE, since their actions are
 * created on the operator's behalf by a plugin they did not configure, so
 * "why did the YouTube tools disappear?" is a question this log line answers.
 */
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
export async function warnIfNothingGranted(strapi: Core.Strapi, actions: string[]): Promise<void> {
  try {
    const granted = await strapi.db.query('admin::permission').count({
      where: { action: { $in: actions } },
    });
    if (granted === 0) {
      strapi.log.warn(
        `[${PLUGIN_NAME}] none of these ${actions.length} tool permission(s) are granted to any ` +
          'role or admin token, so those tools will not appear — not in tools/list, and not in ' +
          'the chat. Grant them in Settings → Roles, or on the admin API token used by your MCP ' +
          `client. Actions: ${actions.slice(0, 4).join(', ')}${actions.length > 4 ? ', …' : ''}`,
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
