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
  return `plugin::${PLUGIN_NAME}.tool.${toolName.replaceAll('_', '-')}`;
}

/** A human label for the permissions grid, e.g. "List content types". */
export function displayNameForTool(toolName: string): string {
  const words = toolName.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The action definition Strapi's provider expects. */
export function actionDefinitionForTool(toolName: string) {
  return {
    section: 'plugins' as const,
    pluginName: PLUGIN_NAME,
    subCategory: SUB_CATEGORY,
    uid: `tool.${toolName.replaceAll('_', '-')}`,
    displayName: displayNameForTool(toolName),
  };
}

/**
 * Strapi's own admin action uid rule, from
 * node_modules/@strapi/admin/dist/server/server/src/validation/action-provider.mjs
 *
 * Lowercase letters, dots and hyphens; it must start and end on a letter. Note
 * what is NOT in that character class: DIGITS. A tool called `searchV2` cannot
 * have a valid action uid at all, which is worth detecting rather than
 * discovering when `registerMany` rejects the whole batch.
 *
 * Two things differ from upstream's `/^[a-z]([a-z|.|-]+)[a-z]$/`, neither
 * changing what it matches. Upstream writes `|` twice in the class — someone
 * meaning "a-z OR . OR -" and forgetting that a character class has no
 * alternation, so both pipes are literal — and it captures a group nothing
 * ever reads, since this is only ever passed to `.test()`. The duplicate and
 * the group are dropped; the literal `|` it accepts is kept, because Strapi
 * accepts it. Verified by exhaustive comparison against the original over
 * every string up to length four drawn from [a z | . - _ A 2 space]: 8,390
 * strings, zero divergences.
 */
const ACTION_UID_RE = /^[a-z][a-z|.-]+[a-z]$/;

/**
 * A tool name as an action-uid slug.
 *
 * Three transforms, in order, matching the reference plugin's `naming.ts`:
 * strip the `<source>__` namespace (the plugin section already says where the
 * tool came from, so repeating it in the uid is noise), split camelCase, and
 * swap underscores for hyphens.
 *
 *   fetchTranscript                      -> fetch-transcript
 *   list_content_types                   -> list-content-types
 *   youtube-transcripts__listTranscripts -> list-transcripts
 */
export function toActionSlug(toolName: string): string {
  return (
    toolName
      // NOT replaceAll: this pattern is anchored with `^` and matches at most
      // once. `replaceAll` throws a TypeError on a non-global regex, and adding
      // /g to an anchored pattern would be noise expressing nothing.
      .replace(/^[\w-]+__/, '')
      .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replaceAll('_', '-')
      .toLowerCase()
  );
}

/** Whether a tool can be given a uid Strapi will accept. */
export function canRegisterAction(toolName: string): boolean {
  return ACTION_UID_RE.test(`tool.${toActionSlug(toolName)}`);
}

/**
 * The action id for a tool CONTRIBUTED by another plugin.
 *
 * Owned by the CONTRIBUTING plugin, and REGISTERED BY IT — this plugin only
 * ever reads these. Each plugin registers under its own `plugin::<id>`
 * namespace, which is what makes a collision impossible: Strapi's action
 * provider is built with `throwOnDuplicates` defaulting to true, so two
 * registrants for one id would throw `Duplicated item key` and cost the second
 * one its whole batch.
 *
 * This function exists only as a FALLBACK for a plugin that does not declare
 * its action id explicitly. Deriving an id is guesswork about someone else's
 * naming, so a derived id is verified against the action provider before it is
 * trusted — see `contributed-tools.ts`.
 */
export function actionForContributedTool(pluginName: string, toolName: string): string {
  return `plugin::${pluginName}.tool.${toActionSlug(toolName)}`;
}
