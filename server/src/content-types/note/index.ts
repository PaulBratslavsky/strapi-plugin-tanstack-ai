import schema from './schema.json';

/**
 * Research notes: snippets, findings and references kept from conversations.
 *
 * Ported from the reference plugin's `note` content type.
 *
 * A NOTE IS NOT A MEMORY, and the difference decides how each is used. A
 * memory is a short fact about the user, replayed into every system prompt. A
 * note is a document — markdown, possibly long — kept to be found again later,
 * so notes are recalled ON DEMAND and never injected wholesale. Putting them
 * in every prompt would spend the context window on material the current
 * question probably has nothing to do with.
 *
 * `tags` is comma-separated text rather than a relation, as in the reference:
 * the model writes them, and inventing a tag must not require creating a row
 * in a second collection first.
 */
export default { schema };
