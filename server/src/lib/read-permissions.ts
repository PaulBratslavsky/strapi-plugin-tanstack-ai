import type { Core } from '@strapi/strapi';

/**
 * Content Manager read permissions, applied to a tool that reads content.
 *
 * WHY THIS EXISTS. A tool's own action (`plugin::tanstack-ai.tool.*`) answers
 * "may this caller use the tool". It says nothing about WHICH content they may
 * read, and `strapi.documents()` does not check either — the document service
 * has no idea who is calling, by design, because cron jobs, lifecycles and seed
 * scripts need it unrestricted. So in 1.0.0 one checkbox on `search_content`
 * read every `api::` type, and a token that Strapi's own `list_product`
 * refused ("Tool list_product disabled") got every Product back from
 * `search_content`. Confirmed against a running server, not argued from types.
 *
 * THE MODEL IS STRAPI'S OWN. Content Manager's list controller and its MCP
 * `list_<type>` handler both do the same three things around the data call,
 * and this is those three things, not a reinterpretation of them:
 *
 *   1. `cannot.read()` — refuse a type the caller holds no read grant on.
 *   2. `sanitizedQuery.read(query)` — remove filters, sorts, fields and
 *      populates on fields the caller cannot read, AND add the permission's
 *      conditions ("only entries I created") as filters. Skipping this is not
 *      just less tidy: a filter on a hidden field, combined with a count,
 *      reads that field's value one `$startsWith` at a time.
 *   3. `sanitizeOutput(doc)` — strip fields the caller cannot read.
 *
 * The checker comes from content-manager rather than being rebuilt from
 * `admin::permission`, because it also resolves action aliases. Content
 * manager is part of every Strapi install; the built-in MCP tools depend on it
 * the same way.
 */

/** The part of content-manager's permission checker a read needs. */
export interface ReadChecker {
  cannot: { read: () => boolean };
  sanitizedQuery: { read: (query: Record<string, unknown>) => Promise<Record<string, unknown>> };
  /** Step 2 without the permission conditions: only removes unreadable fields. */
  sanitizeQuery: (query: Record<string, unknown>) => Promise<Record<string, unknown>>;
  sanitizeOutput: (doc: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * The caller's CASL ability, as Strapi hands it over — `userAbility` on an MCP
 * handler context, `ctx.state.userAbility` on an admin route. Kept opaque:
 * this module only passes it through to the checker.
 */
export type UserAbility = object;

/**
 * One checker per content type, for one caller.
 *
 * Cached because a fan-out asks "can they read it?" while choosing targets and
 * then again to sanitise, and each `create` builds a permissions manager.
 */
export function createReadCheckers(strapi: Core.Strapi, userAbility: UserAbility) {
  const factory = strapi.plugin('content-manager').service('permission-checker') as {
    create: (options: { userAbility: UserAbility; model: string }) => ReadChecker;
  };
  const cache = new Map<string, ReadChecker>();

  return (uid: string): ReadChecker => {
    let checker = cache.get(uid);
    if (!checker) {
      checker = factory.create({ userAbility, model: uid });
      cache.set(uid, checker);
    }
    return checker;
  };
}

/**
 * The content types a caller can read — the rows of the permissions grid.
 *
 * WHICH TYPES: the ones Content Manager displays, taken from Content Manager
 * itself. That is exactly the Collection Types / Single Types grid on an admin
 * role and on an admin token, and the set Strapi's built-in MCP tools are
 * derived from. It is wider than `api::` (1.0.0's rule): a plugin type an
 * operator can see and grant — a YouTube transcript, a users-permissions user —
 * is content too. And it is narrower than the registry: types a plugin hides
 * from Content Manager (`visible: false`) are not in the grid, so nobody can be
 * granted them, so they are not here. This plugin's own conversations,
 * memories and notes are hidden that way, which is what keeps one admin's
 * private rows out of another's search.
 *
 * WHICH OF THOSE: the ones whose Read box is ticked for this caller. For MCP
 * that is the token's grid; for the admin chat, the logged-in admin's role.
 */
export function readableContentTypes(
  strapi: Core.Strapi,
  checkerFor: (uid: string) => ReadChecker,
): { displayed: string[]; readable: string[] } {
  const service = strapi.plugin('content-manager').service('content-types') as {
    findDisplayedContentTypes: () => Array<{ uid: string }>;
  };
  const displayed = service.findDisplayedContentTypes().map((contentType) => contentType.uid);
  const readable = displayed.filter((uid) => !checkerFor(uid).cannot.read());
  return { displayed, readable };
}

/**
 * The caller's ability from an MCP handler context, or undefined.
 *
 * Every real caller has one — MCP builds it from the token, the admin chat
 * passes the admin's. Tools treat its absence as "no access", never as
 * "unrestricted": the safe failure of a read path is no data, loudly.
 */
export function abilityFrom(context: unknown): UserAbility | undefined {
  return (context as { userAbility?: UserAbility } | undefined)?.userAbility;
}

/**
 * The one answer for a content type the caller cannot use.
 *
 * THE SAME TEXT whether the type does not exist, is hidden from Content
 * Manager, or exists without a Read grant. Two different messages let a caller
 * probe guessed uids for types they are not allowed to know about — and the
 * tools already hide unreadable types everywhere else (`list_content_types`
 * does not describe them, fan-outs do not count them), so an error that
 * confirmed one would undo that. Raised in review on the 1.1.0 PR.
 *
 * It still lists what IS available, which is all a model needs to retry.
 */
export function unavailableTypeMessage(uid: string, readable: string[]): string {
  return `Content type "${uid}" is not available to you. Available: ${readable.join(', ') || '(none)'}`;
}
