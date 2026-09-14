import { ai } from '@strapi/strapi';
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { actionForTool } from '../lib/tool-permissions';
import { jsonCoercible } from '../lib/json-coercible';
import {
  abilityFrom,
  createReadCheckers,
  readableContentTypes,
  unavailableTypeMessage,
  type ReadChecker,
} from '../lib/read-permissions';

/**
 * `search_content` — the tool the per-type built-ins structurally cannot be.
 *
 * Strapi's official MCP publishes `list_article`, `list_page`, `list_product`.
 * Each is fine on its own and none of them can answer "search everything I
 * have for X", because that question is not about a type — it is about the
 * library. Omit `contentType` here and the search fans out across every
 * content type the caller can read, which is the whole reason this plugin
 * exists. "Can read" means the permissions grid: the token's over MCP, the
 * logged-in admin's role in the chat (see `lib/read-permissions`).
 *
 * Naming it `search_content` rather than `tsai_search_content`: the prefix
 * exists to avoid collisions with built-ins, and there is no built-in by this
 * name — a per-type server cannot produce one.
 */

/** Hard ceiling regardless of what the model asks for. */
const MAX_PAGE_SIZE = 50;
/** Ceiling on how many types a fan-out will touch in one call. */
const MAX_TYPES_SCANNED = 25;

/**
 * Fields stripped from results by default.
 *
 * A single article body can be tens of kilobytes. Returning ten of them
 * answers the question and leaves no context to reason with, so the default is
 * to omit them and let the model ask for what it actually needs — either with
 * `includeContent` or by naming `fields`.
 */
const LARGE_CONTENT_FIELDS = new Set([
  'content',
  'blocks',
  'body',
  'richText',
  'markdown',
  'html',
  'description',
]);

const outputSchema = () =>
  z.object({
    results: z.array(
      z.object({
        contentType: z.string().describe('Which type this row came from — set on every result, because a fan-out mixes them.'),
        documentId: z.string().optional(),
        data: z.record(z.string(), z.unknown()),
      }),
    ),
    /** Per type, because a fan-out has no single total worth reporting. */
    totals: z.array(z.object({ contentType: z.string(), total: z.number() })),
    scanned: z.number().describe('How many content types were searched.'),
    truncated: z.boolean().describe('True when more types exist than were scanned.'),
  });

type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;

function stripLarge(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!LARGE_CONTENT_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

interface SearchRow {
  contentType: string;
  documentId?: string;
  data: Record<string, unknown>;
}

/** Arguments as the schema resolves them; only what the helpers below read. */
interface SearchArgs {
  contentType?: string;
  query?: string;
  filters?: Record<string, unknown>;
  fields?: string[];
  sort?: string;
  page?: number;
  pageSize?: number;
  status?: 'draft' | 'published';
  locale?: string;
  includeContent?: boolean;
}

const errorResult = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true as const,
});

/**
 * The two ways a call is wrong, answered before any query runs.
 *
 * Both name the fix. A model that gets an opaque failure retries with the same
 * arguments; one told what is available, or which argument needs a companion,
 * retries with something different.
 */
function refuse(args: SearchArgs, readable: string[]) {
  // Unknown, hidden and unreadable get ONE answer — see unavailableTypeMessage.
  if (args.contentType && !readable.includes(args.contentType)) {
    return errorResult(unavailableTypeMessage(args.contentType, readable));
  }

  // `filters` and `sort` reference fields of ONE schema. Applied across
  // heterogeneous types they would match whatever happened to fit and quietly
  // drop the rest, which reads as "no results" rather than as a misuse.
  if (!args.contentType && (args.filters || args.sort)) {
    return errorResult(
      'filters and sort name fields of a specific schema, so they need `contentType`. ' +
        'Either pass one, or search across all types with `query` alone.',
    );
  }

  return null;
}

/**
 * Attribute types a text search matches, as Strapi's own `_q` defines them
 * (`@strapi/database` query/helpers/search.js): text-like fields always, number
 * fields only when the search text is itself a number.
 */
const TEXT_TYPES = new Set(['string', 'text', 'uid', 'email', 'enumeration', 'richtext']);
const NUMBER_TYPES = new Set(['integer', 'biginteger', 'decimal', 'float']);

type SchemaAttributes = Record<string, { type: string; searchable?: boolean }>;

/**
 * One filter per field a text search should look at.
 *
 * WHY NOT `_q`. Strapi's `_q` matches every searchable field on the type, and
 * the permission sanitiser never touches it — it only cleans `filters`, `sort`,
 * `fields` and `populate`. So a caller who may read Products but not `price`
 * could search "2400", get "Enterprise Plugin Support" back with the price
 * stripped, and know the price anyway. Spelling the search out as ordinary
 * filters puts it where the sanitiser already works: the clauses on fields the
 * caller cannot read are removed by Strapi, not by a field list this plugin
 * would have to keep in step with Strapi's rules.
 *
 * Numbers match exactly (`$eq`) rather than by substring as `_q` does: a
 * `LIKE` on a numeric column is dialect-specific, and exact is the stricter of
 * the two. `id` is included as `_q` includes it; it is always readable.
 */
function textSearchClauses(strapi: Core.Strapi, uid: string, text: string) {
  const attributes =
    (strapi.contentTypes as unknown as Record<string, { attributes?: SchemaAttributes } | undefined>)[uid]
      ?.attributes ?? {};
  const asNumber = Number(text);
  const numeric = text.trim() !== '' && !Number.isNaN(asNumber);

  const clauses: Array<Record<string, unknown>> = numeric ? [{ id: { $eq: asNumber } }] : [];
  for (const [name, attribute] of Object.entries(attributes)) {
    if (attribute.searchable === false) continue;
    if (TEXT_TYPES.has(attribute.type)) clauses.push({ [name]: { $containsi: text } });
    else if (numeric && NUMBER_TYPES.has(attribute.type)) clauses.push({ [name]: { $eq: asNumber } });
  }
  return clauses;
}

const isNonEmptyObject = (value: unknown) =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0;

/**
 * The text search, reduced to the fields this caller may read — or null when
 * none are left.
 *
 * THE NULL IS THE WHOLE SAFETY OF THIS. When every clause names a hidden field,
 * the sanitiser does not leave an `$or` that matches nothing; it deletes the
 * emptied `$or`, and a query with no search filter matches EVERY row. Without
 * this check, searching for anything on a type whose text fields are all
 * hidden would return the whole table.
 */
async function permittedSearch(strapi: Core.Strapi, uid: string, text: string, checker: ReadChecker) {
  const clauses = textSearchClauses(strapi, uid, text);
  if (clauses.length === 0) return null;

  const { filters } = await checker.sanitizeQuery({ filters: { $or: clauses } });
  const surviving = (filters as { $or?: unknown[] } | undefined)?.$or?.filter((clause) => isNonEmptyObject(clause)) ?? [];
  return surviving.length > 0 ? { $or: surviving } : null;
}

/**
 * The caller's query, cut down to what their read permissions allow, or null
 * when a text search has no readable field left to match.
 *
 * `populate` goes in here, not after, so populated relations and components
 * are sanitised too — not just the top-level fields.
 */
async function permittedQuery(strapi: Core.Strapi, uid: string, args: SearchArgs, checker: ReadChecker) {
  let search: Record<string, unknown> | undefined;
  if (args.query) {
    const found = await permittedSearch(strapi, uid, args.query, checker);
    if (!found) return null;
    search = found;
  }
  const filters = search && args.filters ? { $and: [args.filters, search] } : (search ?? args.filters);

  return checker.sanitizedQuery.read({
    ...(filters ? { filters } : {}),
    ...(args.fields ? { fields: args.fields } : {}),
    ...(args.sort ? { sort: args.sort } : {}),
    populate: '*',
  });
}

/**
 * Search one content type, as the caller.
 *
 * NEVER THROWS. One unsearchable type must not fail the whole fan-out, so it
 * reports zero and the model still gets the types that did work. (Types the
 * caller cannot read never get here; they are removed while choosing targets,
 * so they do not show up as a zero.)
 *
 * The query goes through the caller's read permissions BEFORE it runs, and
 * every row goes through them after — see `lib/read-permissions`. `page`,
 * `pageSize`, `status` and `locale` are added after sanitising because they
 * name no field, which is also how Content Manager's own list handler does it.
 */
async function searchOne(
  strapi: Core.Strapi,
  uid: string,
  args: SearchArgs,
  checker: ReadChecker,
): Promise<{ total: number; rows: SearchRow[] }> {
  const pageSize = Math.min(args.pageSize ?? 10, MAX_PAGE_SIZE);
  const strip = !args.includeContent && !args.fields;

  try {
    const permitted = await permittedQuery(strapi, uid, args, checker);
    if (!permitted) return { total: 0, rows: [] };

    const dimensions = {
      ...(args.status ? { status: args.status } : {}),
      ...(args.locale ? { locale: args.locale } : {}),
    };

    const docs = (await strapi.documents(uid as never).findMany({
      ...permitted,
      ...dimensions,
      page: args.page ?? 1,
      pageSize,
    } as never)) as Array<Record<string, unknown>>;

    // The count takes the SAME permitted filters. A total built from the raw
    // ones would report rows the caller is not allowed to see — "3 matches"
    // beside zero rows is the leak in a different place.
    const total = (await strapi.documents(uid as never).count({
      filters: permitted.filters,
      ...dimensions,
    } as never)) as number;

    const rows: SearchRow[] = [];
    for (const doc of docs) {
      const visible = await checker.sanitizeOutput(doc);
      rows.push({
        contentType: uid,
        ...(typeof visible.documentId === 'string' ? { documentId: visible.documentId } : {}),
        data: strip ? stripLarge(visible) : visible,
      });
    }

    return { total, rows };
  } catch (error) {
    strapi.log.debug(
      `[tanstack-ai] search_content skipped ${uid}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return { total: 0, rows: [] };
  }
}

export const searchContent = ai.mcp.defineTool({
  name: 'search_content',
  title: 'TanStack AI: Search Content',
  description:
    'Search Strapi content. Omit `contentType` to search EVERY content type at once — this is the ' +
    'only way to answer questions about the whole library, since the built-in tools are per type. ' +
    'Give `contentType` to search one type with filters and sorting. Call list_content_types first ' +
    'if you do not know what exists. Large text fields are stripped unless you pass includeContent ' +
    'or name specific `fields`, so results stay small enough to reason about.',

  auth: { policies: [{ action: actionForTool('search_content') }] },

  resolveInputSchema: () =>
    z.object({
      contentType: z
        .string()
        .optional()
        .describe(
          'e.g. "api::article.article". OMIT to search every content type you can read.',
        ),
      query: z
        .string()
        .optional()
        .describe('Text to find in any text field you can read; a number also matches number fields exactly.'),
      filters: jsonCoercible(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          'Strapi filters, single-type searches only. Scalar: { title: { $containsi: "hello" } }. ' +
            'Relation: { author: { name: { $eq: "Ada" } } }. Operators: $eq, $ne, $containsi, $in, ' +
            '$gt, $lt, $gte, $lte, $null, $notNull.',
        ),
      fields: jsonCoercible(z.array(z.string()))
        .optional()
        .describe('Return only these fields. Implies includeContent for the fields you name.'),
      sort: z.string().optional().describe('e.g. "createdAt:desc". Single-type searches only.'),
      page: z.number().optional().describe('1-based. Single-type searches only.'),
      pageSize: z.number().optional().describe(`Rows per content type. Max ${MAX_PAGE_SIZE}.`),
      status: z
        .enum(['draft', 'published'])
        .optional()
        .describe('Strapi returns drafts by default; pass "published" for live content only.'),
      locale: z.string().optional().describe('i18n locale, e.g. "en".'),
      includeContent: z
        .boolean()
        .optional()
        .describe('Include large text fields (body, content, blocks…). Default false.'),
    }),

  resolveOutputSchema: outputSchema,

  createHandler: (strapi: Core.Strapi, context) => async ({ args }): Promise<ToolResult> => {
    // FAIL CLOSED — see `abilityFrom`.
    const userAbility = abilityFrom(context);
    if (!userAbility) {
      return errorResult(
        "search_content could not determine the caller's permissions, so it searched nothing.",
      );
    }
    const checkerFor = createReadCheckers(strapi, userAbility);

    // The grid's rows, and the ones this caller has Read on. Unreadable types
    // are removed BEFORE the scan cap, so they neither appear in `totals` (a
    // count is data) nor use up the budget and push readable types off the end.
    const { readable } = readableContentTypes(strapi, checkerFor);

    const refusal = refuse(args, readable);
    if (refusal) return refusal;


    const targets = args.contentType ? [args.contentType] : readable.slice(0, MAX_TYPES_SCANNED);
    const results: SearchRow[] = [];
    const totals: Array<{ contentType: string; total: number }> = [];

    for (const uid of targets) {
      // Awaited in sequence on purpose: a fan-out across 25 types in parallel
      // is 50 concurrent queries against one database, which is a good way to
      // make a search feel like an outage.
      const found = await searchOne(strapi, uid, args, checkerFor(uid));
      totals.push({ contentType: uid, total: found.total });
      results.push(...found.rows);
    }

    const payload = {
      results,
      totals,
      scanned: targets.length,
      truncated: !args.contentType && readable.length > MAX_TYPES_SCANNED,
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
