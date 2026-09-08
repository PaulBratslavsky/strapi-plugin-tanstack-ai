import { ai } from '@strapi/strapi';
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { actionForTool } from '../lib/tool-permissions';
import { jsonCoercible } from '../lib/json-coercible';

/**
 * `search_content` — the tool the per-type built-ins structurally cannot be.
 *
 * Strapi's official MCP publishes `list_article`, `list_page`, `list_product`.
 * Each is fine on its own and none of them can answer "search everything I
 * have for X", because that question is not about a type — it is about the
 * library. Omit `contentType` here and the search fans out across every
 * `api::` type, which is the whole reason this plugin exists.
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
function refuse(args: SearchArgs, apiTypes: string[]) {
  if (args.contentType && !apiTypes.includes(args.contentType)) {
    return errorResult(
      `No content type "${args.contentType}". Available: ${apiTypes.join(', ') || '(none)'}`,
    );
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
 * Search one content type.
 *
 * NEVER THROWS. One unsearchable type — a schema with no text field, or one
 * the caller cannot read — must not fail the whole fan-out, so it reports zero
 * and the model still gets the types that did work.
 */
async function searchOne(
  strapi: Core.Strapi,
  uid: string,
  args: SearchArgs,
): Promise<{ total: number; rows: SearchRow[] }> {
  const pageSize = Math.min(args.pageSize ?? 10, MAX_PAGE_SIZE);
  const strip = !args.includeContent && !args.fields;

  const common = {
    ...(args.query ? { _q: args.query } : {}),
    ...(args.filters ? { filters: args.filters } : {}),
    ...(args.status ? { status: args.status } : {}),
    ...(args.locale ? { locale: args.locale } : {}),
  };

  try {
    const docs = (await strapi.documents(uid as never).findMany({
      ...common,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.sort ? { sort: args.sort } : {}),
      page: args.page ?? 1,
      pageSize,
      populate: '*',
    } as never)) as Array<Record<string, unknown>>;

    const total = (await strapi.documents(uid as never).count(common as never)) as number;

    return {
      total,
      rows: docs.map((doc) => ({
        contentType: uid,
        ...(typeof doc.documentId === 'string' ? { documentId: doc.documentId } : {}),
        data: strip ? stripLarge(doc) : doc,
      })),
    };
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
        .describe('e.g. "api::article.article". OMIT to search across all content types.'),
      query: z.string().optional().describe('Full-text search across searchable text fields.'),
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

  createHandler: (strapi: Core.Strapi) => async ({ args }): Promise<ToolResult> => {
    const apiTypes = Object.values(strapi.contentTypes)
      .filter((contentType) => contentType.uid.startsWith('api::'))
      .map((contentType) => contentType.uid);

    const refusal = refuse(args, apiTypes);
    if (refusal) return refusal;

    const targets = args.contentType ? [args.contentType] : apiTypes.slice(0, MAX_TYPES_SCANNED);
    const results: SearchRow[] = [];
    const totals: Array<{ contentType: string; total: number }> = [];

    for (const uid of targets) {
      // Awaited in sequence on purpose: a fan-out across 25 types in parallel
      // is 50 concurrent queries against one database, which is a good way to
      // make a search feel like an outage.
      const found = await searchOne(strapi, uid, args);
      totals.push({ contentType: uid, total: found.total });
      results.push(...found.rows);
    }

    const payload = {
      results,
      totals,
      scanned: targets.length,
      truncated: !args.contentType && apiTypes.length > MAX_TYPES_SCANNED,
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
