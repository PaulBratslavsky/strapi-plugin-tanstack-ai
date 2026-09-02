/**
 * The admin permission action each MCP tool is gated behind.
 *
 * WHY OUR OWN ACTION, RATHER THAN BORROWING ONE. The first attempt gated
 * `list_content_types` behind `plugin::content-manager.explorer.read`, on the
 * reasoning that reading the schema is a kind of read. The tool registered and
 * then never appeared in `tools/list`, silently.
 *
 * The reason is worth writing down. Strapi enables an MCP capability per
 * session with:
 *
 *   auth.policies.some(({ action, subject }) =>
 *     subject !== undefined ? ability.can(action, subject) : ability.can(action))
 *
 * A policy with no subject therefore asks "can this caller do X on ANYTHING?",
 * and content-manager grants are always scoped to a specific content type
 * (`subject: "api::article.article"`). The subject-less check fails, and a tool
 * whose policy names a subject-scoped action is invisible — with no error, on
 * either side.
 *
 * A cross-type tool has no single subject it could name, so borrowing that
 * action cannot work. Our tools get their own subject-less actions instead,
 * which is also the more honest model: "may call this plugin's tool" is a
 * different question from "may read articles".
 */

export const PLUGIN_NAME = 'tanstack-ai';

/** Grouping label in the admin permissions grid. */
export const SUB_CATEGORY = 'MCP tools';

/**
 * The action id for a tool.
 *
 * Strapi's admin action uid validator accepts lowercase letters, dots and
 * hyphens — no underscores — so the uid tail is the tool's snake_case name
 * with hyphens, while the MCP tool name itself stays snake_case.
 */
export function actionForTool(toolName: string): string {
  return `plugin::${PLUGIN_NAME}.tool.${toolName.replace(/_/g, '-')}`;
}

/** A human label for the permissions grid, e.g. "List content types". */
export function displayNameForTool(toolName: string): string {
  const words = toolName.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The action definition Strapi's provider expects. */
export function actionDefinitionForTool(toolName: string) {
  return {
    section: 'plugins' as const,
    pluginName: PLUGIN_NAME,
    subCategory: SUB_CATEGORY,
    uid: `tool.${toolName.replace(/_/g, '-')}`,
    displayName: displayNameForTool(toolName),
  };
}
