import schema from './schema.json';

/**
 * Chat history, one row per conversation.
 *
 * Ported from the reference plugin's `conversation` content type, including
 * the two decisions that are easy to miss:
 *
 * `adminUserId` — history is PER ADMIN USER. Strapi's admin is multi-user, and
 * a shared transcript would leak one person's questions (and any content they
 * name) to every colleague with panel access.
 *
 * `content-manager.visible: false` — this is plugin bookkeeping, not part of
 * the host's content model. Left visible it would appear in the Content
 * Manager as a collection to browse and edit by hand, and in the
 * Content-Type Builder as something to "fix". It also keeps it out of this
 * plugin's own tools for free, since those only ever look at `api::` types.
 */
export default { schema };
