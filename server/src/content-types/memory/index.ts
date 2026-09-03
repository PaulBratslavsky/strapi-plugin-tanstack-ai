import schema from './schema.json';

/**
 * Facts the assistant has been told to remember about one admin user.
 *
 * Ported from the reference plugin's `memory` content type. Per-user for the
 * same reason conversations are, only more so: a memory is by definition
 * personal ("prefers short answers", "works on the pricing page"), and sharing
 * it across an admin team would be both wrong and startling.
 *
 * `text` rather than the reference's `richtext`: a memory is a sentence the
 * model wrote for itself to read back. Rich text would invite formatting that
 * costs tokens in every system prompt and renders as markup in the panel's
 * plain list.
 */
export default { schema };
