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
import { countBuckets, countGroups, type Granularity, type GroupSpec } from '../lib/aggregate';

/**
 * `aggregate_content` — counts, breakdowns and trends, without the rows.
 *
 * "How many articles per category?" answered with `search_content` means
 * pulling pages of documents into the model's context to count them by eye,
 * which is slow, expensive, and wrong past the first page. This answers it
 * with numbers. Nothing built into Strapi's MCP server counts or groups at all.
 *
 * PORTED FROM the reference plugin's `tool-logic/aggregate-content.ts`: the
 * three operations, their arguments, and relation fields resolving to a
 * readable label ("author" groups by `author.name`). Three things differ, and
 * each is a defect in the original rather than a preference:
 *
 *   1. PERMISSIONS. The same rules as `search_content` (`lib/read-permissions`):
 *      only types with Read, filters sanitised with the permission's
 *      conditions. And grouping is itself a read — a group label IS the
 *      field's value — so the group field, the date field, and for a relation
 *      the related type and its label field must all be readable, or the call
 *      is refused naming what is missing.
 *   2. NO SILENT CAP. The reference stopped loading at 1,000 documents and
 *      reported the groups as if complete. Here `total` is always an exact
 *      `count()`; grouping scans at most MAX_SCANNED rows, fetching only the
 *      one field it needs, and says `partial: true` with `scanned` when it
 *      stopped short — so a model can say "of the first 10,000 of 42,113".
 *   3. UTC BUCKETS. See `lib/aggregate`.
 *
 * WHY SCAN, NOT GROUP BY IN SQL. A database GROUP BY is exact at any size, but
 * it bypasses the document service — so draft/published and locale stop meaning
 * what they mean everywhere else — and the permission sanitiser with it.
 */

/** Rows a grouping will read before reporting a partial result. */
export const MAX_SCANNED = 10_000;
/** Rows per page while scanning; only one field is selected, so pages are small. */
const PAGE_SIZE = 500;

/** Attribute types whose value makes a meaningful group label. */
const GROUPABLE_TYPES = new Set([
  'string',
  'text',
  'uid',
  'email',
  'enumeration',
  'integer',
  'biginteger',
  'decimal',
  'float',
  'boolean',
  'date',
  'datetime',
  'time',
]);
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
/** Fields tried, in order, as a related type's label. From the reference. */
const LABEL_CANDIDATES = ['name', 'title', 'username', 'label', 'slug', 'email'];
const TEXT_LABEL_TYPES = new Set(['string', 'text', 'email', 'uid']);

type Attribute = { type: string; relation?: string; target?: string };
type Operation = 'count' | 'countByField' | 'countByDateRange';

interface AggregateArgs {
  contentType?: string;
  operation: Operation;
  filters?: Record<string, unknown>;
  groupByField?: string;
  dateField?: string;
  granularity?: Granularity;
  dateFrom?: string;
  dateTo?: string;
  status?: 'draft' | 'published';
  locale?: string;
}

const outputSchema = () =>
  z.object({
    operation: z.enum(['count', 'countByField', 'countByDateRange']),
    contentType: z.string().optional(),
    total: z.number().describe('Exact number of matching documents.'),
    totals: z
      .array(z.object({ contentType: z.string(), total: z.number() }))
      .optional()
      .describe('Per type, when counting across every readable type.'),
    groups: z.array(z.object({ value: z.string(), count: z.number() })).optional(),
    buckets: z.array(z.object({ period: z.string(), count: z.number() })).optional(),
    resolvedField: z.string().optional().describe('The field actually grouped on, e.g. "author.name".'),
    undated: z.number().optional().describe('Scanned documents with no value in the date field.'),
    scanned: z.number().optional().describe('Documents read to build groups or buckets.'),
    partial: z
      .boolean()
      .optional()
      .describe('True when groups or buckets cover only the first `scanned` of `total` documents.'),
  });

type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;
type Payload = ReturnType<typeof outputSchema>['_output'];

const errorResult = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true as const,
});

const ok = (payload: Payload): ToolResult => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  structuredContent: payload,
});

const attributesOf = (strapi: Core.Strapi, uid: string): Record<string, Attribute> =>
  (strapi.contentTypes as unknown as Record<string, { attributes?: Record<string, Attribute> } | undefined>)[uid]
    ?.attributes ?? {};

/**
 * Whether a scalar field survives the caller's read permissions.
 *
 * Asked of Strapi's sanitiser rather than of the ability directly, because the
 * sanitiser knows the exceptions — `createdAt`, `updatedAt` and friends are
 * readable to anyone who can read the type, though no permission names them.
 */
async function canReadField(checker: ReadChecker, field: string): Promise<boolean> {
  const { fields } = await checker.sanitizeQuery({ fields: [field] });
  return Array.isArray(fields) && fields.includes(field);
}

/** The same question for a relation, which is populated rather than selected. */
async function canReadRelation(checker: ReadChecker, field: string): Promise<boolean> {
  const { populate } = await checker.sanitizeQuery({ populate: { [field]: true } });
  return typeof populate === 'object' && populate !== null && Object.hasOwn(populate, field);
}

type Resolved = { spec: GroupSpec; resolvedField: string } | { error: string };

/** The first label field on the related type that the caller may read. */
async function readableLabelField(checker: ReadChecker, attributes: Record<string, Attribute>) {
  for (const candidate of LABEL_CANDIDATES) {
    const attribute = attributes[candidate];
    if (attribute && TEXT_LABEL_TYPES.has(attribute.type) && (await canReadField(checker, candidate))) {
      return candidate;
    }
  }
  // Always readable, and at least distinguishes the related documents.
  return 'documentId';
}

async function resolveRelation(
  strapi: Core.Strapi,
  uid: string,
  field: string,
  attribute: Attribute,
  subField: string | undefined,
  checkerFor: (uid: string) => ReadChecker,
): Promise<Resolved> {
  const target = attribute.target;
  if (!target) return { error: `"${field}" is a polymorphic relation and cannot be grouped on.` };
  if (!(await canReadRelation(checkerFor(uid), field))) {
    return { error: `You do not have permission to read "${field}" on "${uid}".` };
  }

  // A group label is a value FROM the related type. Grouping articles by
  // author prints author names; that is reading authors.
  const targetChecker = checkerFor(target);
  if (targetChecker.cannot.read()) {
    return {
      error: `Grouping by "${field}" would show values from "${target}", which you do not have permission to read.`,
    };
  }

  const targetAttributes = attributesOf(strapi, target);
  let label = subField;
  if (label) {
    const labelAttribute = targetAttributes[label];
    if (!labelAttribute || !GROUPABLE_TYPES.has(labelAttribute.type)) {
      return { error: `"${target}" has no groupable field "${label}".` };
    }
    if (!(await canReadField(targetChecker, label))) {
      return { error: `You do not have permission to read "${label}" on "${target}".` };
    }
  } else {
    label = await readableLabelField(targetChecker, targetAttributes);
  }

  const many = (attribute.relation ?? '').endsWith('ToMany');
  return { spec: { kind: 'relation', field, subField: label, many }, resolvedField: `${field}.${label}` };
}

/**
 * Turn `groupByField` into something safe to read, or a refusal naming why not.
 *
 * Refusing matters more here than in a search. Sanitising would quietly drop
 * an unreadable field from the select, every row would then have no value, and
 * the answer would be one confident group — "(empty): 312" — that is simply
 * false.
 */
async function resolveGroup(
  strapi: Core.Strapi,
  uid: string,
  path: string,
  checkerFor: (uid: string) => ReadChecker,
): Promise<Resolved> {
  const [field, subField, ...deeper] = path.split('.');
  if (deeper.length > 0) return { error: `"${path}" nests too deeply; group on "field" or "relation.field".` };

  const attribute = attributesOf(strapi, uid)[field];
  if (!attribute) {
    return { error: `"${uid}" has no field "${field}". Call list_content_types to see its fields.` };
  }
  if (attribute.type === 'relation') {
    return resolveRelation(strapi, uid, field, attribute, subField, checkerFor);
  }
  if (subField) return { error: `"${field}" is not a relation, so "${path}" has nothing to follow.` };
  if (!GROUPABLE_TYPES.has(attribute.type)) {
    return { error: `"${field}" is a ${attribute.type} field and cannot be grouped on.` };
  }
  if (!(await canReadField(checkerFor(uid), field))) {
    return { error: `You do not have permission to read "${field}" on "${uid}".` };
  }
  return { spec: { kind: 'scalar', field }, resolvedField: field };
}

/** The date field and range, checked. Null when they are fine. */
async function refuseDates(strapi: Core.Strapi, uid: string, args: AggregateArgs, checker: ReadChecker) {
  const dateField = args.dateField ?? 'createdAt';
  const attribute = attributesOf(strapi, uid)[dateField];
  if (!attribute || !DATE_TYPES.has(attribute.type)) {
    return errorResult(`"${dateField}" is not a date field on "${uid}".`);
  }
  if (!(await canReadField(checker, dateField))) {
    return errorResult(`You do not have permission to read "${dateField}" on "${uid}".`);
  }
  for (const bound of [args.dateFrom, args.dateTo]) {
    if (bound !== undefined && Number.isNaN(Date.parse(bound))) {
      return errorResult(`"${bound}" is not a date. Use ISO 8601, e.g. "2026-09-01".`);
    }
  }
  return null;
}

function combineFilters(args: AggregateArgs, withDates: boolean) {
  const parts: Array<Record<string, unknown>> = [];
  if (args.filters) parts.push(args.filters);
  if (withDates && (args.dateFrom || args.dateTo)) {
    parts.push({
      [args.dateField ?? 'createdAt']: {
        ...(args.dateFrom ? { $gte: args.dateFrom } : {}),
        ...(args.dateTo ? { $lte: args.dateTo } : {}),
      },
    });
  }
  return parts.length > 1 ? { $and: parts } : parts[0];
}

const dimensionsOf = (args: AggregateArgs) => ({
  ...(args.status ? { status: args.status } : {}),
  ...(args.locale ? { locale: args.locale } : {}),
});

/**
 * Read matching rows a page at a time, up to MAX_SCANNED.
 *
 * `page`, `pageSize`, the selected field and the relation populate go on AFTER
 * sanitising, as in Content Manager's own list handler. The field and relation
 * were checked readable by `resolveGroup` / `refuseDates` first; handing a
 * nested populate to the sanitiser instead would have it judge the RELATED
 * type's fields against this type's permission list.
 */
async function scanRows(strapi: Core.Strapi, uid: string, query: Record<string, unknown>) {
  const rows: Array<Record<string, unknown>> = [];
  let page = 1;
  while (rows.length < MAX_SCANNED) {
    const batch = (await strapi.documents(uid as never).findMany({
      ...query,
      page,
      pageSize: PAGE_SIZE,
    } as never)) as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page++;
  }
  return rows.slice(0, MAX_SCANNED);
}

function selectFor(spec: GroupSpec) {
  if (spec.kind === 'scalar') return { fields: [spec.field] };
  return { fields: ['documentId'], populate: { [spec.field]: { fields: [spec.subField] } } };
}

/** `count` with no contentType: a total per readable type. */
async function countAcrossTypes(
  strapi: Core.Strapi,
  args: AggregateArgs,
  readable: string[],
  checkerFor: (uid: string) => ReadChecker,
): Promise<ToolResult> {
  if (args.operation !== 'count') {
    return errorResult(`${args.operation} needs a contentType. Only "count" works across every type.`);
  }
  // Same reason as search_content: these name fields of ONE schema.
  if (args.filters || args.groupByField || args.dateFrom || args.dateTo) {
    return errorResult(
      'filters and date ranges name fields of a specific schema, so they need `contentType`. ' +
        'Omit them to count every type, or pass one type.',
    );
  }

  const totals: Array<{ contentType: string; total: number }> = [];
  for (const uid of readable) {
    // No caller filters, but the permission's own conditions still apply.
    const permitted = await checkerFor(uid).sanitizedQuery.read({});
    const total = (await strapi.documents(uid as never).count({
      filters: permitted.filters,
      ...dimensionsOf(args),
    } as never)) as number;
    totals.push({ contentType: uid, total });
  }
  return ok({
    operation: 'count',
    total: totals.reduce((sum, entry) => sum + entry.total, 0),
    totals,
  });
}

async function aggregateOneType(
  strapi: Core.Strapi,
  uid: string,
  args: AggregateArgs,
  checkerFor: (uid: string) => ReadChecker,
): Promise<ToolResult> {
  const checker = checkerFor(uid);
  const usesDates = args.operation === 'countByDateRange' || Boolean(args.dateFrom || args.dateTo);
  if (usesDates) {
    const refusal = await refuseDates(strapi, uid, args, checker);
    if (refusal) return refusal;
  }

  let group: Extract<Resolved, { spec: GroupSpec }> | undefined;
  if (args.operation === 'countByField') {
    if (!args.groupByField) return errorResult('countByField needs `groupByField`, e.g. "category".');
    const resolved = await resolveGroup(strapi, uid, args.groupByField, checkerFor);
    if ('error' in resolved) return errorResult(resolved.error);
    group = resolved;
  }

  const filters = combineFilters(args, usesDates);
  const permitted = await checker.sanitizedQuery.read(filters ? { filters } : {});
  const dimensions = dimensionsOf(args);
  const total = (await strapi.documents(uid as never).count({
    filters: permitted.filters,
    ...dimensions,
  } as never)) as number;

  if (args.operation === 'count') return ok({ operation: 'count', contentType: uid, total });

  const select = group ? selectFor(group.spec) : { fields: [args.dateField ?? 'createdAt'] };
  const rows = await scanRows(strapi, uid, { filters: permitted.filters, ...select, ...dimensions });
  const coverage = { scanned: rows.length, partial: rows.length < total };

  if (group) {
    return ok({
      operation: 'countByField',
      contentType: uid,
      total,
      groups: countGroups(rows, group.spec),
      resolvedField: group.resolvedField,
      ...coverage,
    });
  }

  const { buckets, undated } = countBuckets(rows, args.dateField ?? 'createdAt', args.granularity ?? 'month');
  return ok({ operation: 'countByDateRange', contentType: uid, total, buckets, undated, ...coverage });
}

export const aggregateContent = ai.mcp.defineTool({
  name: 'aggregate_content',
  title: 'TanStack AI: Aggregate Content',
  description:
    'Count and break down Strapi content without fetching it. Use this instead of search_content for ' +
    '"how many", "per category", "breakdown", "distribution" and "over time" questions. Operations: ' +
    '`count` (omit contentType to total every type you can read), `countByField` (needs groupByField; ' +
    'a relation such as "author" groups by its name), `countByDateRange` (buckets by day, week or ' +
    'month). `total` is always exact; if `partial` is true, groups and buckets cover only the first ' +
    '`scanned` documents — say so when answering.',

  auth: { policies: [{ action: actionForTool('aggregate_content') }] },

  resolveInputSchema: () =>
    z.object({
      operation: z
        .enum(['count', 'countByField', 'countByDateRange'])
        .describe('count — total; countByField — group by a field; countByDateRange — bucket by date.'),
      contentType: z
        .string()
        .optional()
        .describe('e.g. "api::article.article". Omit only with operation "count", to count every type.'),
      filters: jsonCoercible(z.record(z.string(), z.unknown()))
        .optional()
        .describe('Strapi filters, e.g. { category: { $eq: "tutorial" } }. Needs contentType.'),
      groupByField: z
        .string()
        .optional()
        .describe('Field to group by, e.g. "category". A relation ("author") groups by its name; "author.email" picks the field.'),
      dateField: z.string().optional().describe('Date field for countByDateRange or a date range. Default "createdAt".'),
      granularity: z.enum(['day', 'week', 'month']).optional().describe('Bucket size for countByDateRange. Default "month". Weeks start Monday, UTC.'),
      dateFrom: z.string().optional().describe('ISO date, inclusive lower bound on dateField.'),
      dateTo: z.string().optional().describe('ISO date, inclusive upper bound on dateField.'),
      status: z
        .enum(['draft', 'published'])
        .optional()
        .describe('Omit to count every document; "published" counts only live ones.'),
      locale: z.string().optional().describe('i18n locale, e.g. "en".'),
    }),

  resolveOutputSchema: outputSchema,

  createHandler: (strapi: Core.Strapi, context) => async ({ args }): Promise<ToolResult> => {
    // FAIL CLOSED — see `abilityFrom`.
    const userAbility = abilityFrom(context);
    if (!userAbility) {
      return errorResult("aggregate_content could not determine the caller's permissions, so it counted nothing.");
    }
    const checkerFor = createReadCheckers(strapi, userAbility);
    const { readable } = readableContentTypes(strapi, checkerFor);

    if (!args.contentType) return countAcrossTypes(strapi, args, readable, checkerFor);
    // Unknown, hidden and unreadable get ONE answer — see unavailableTypeMessage.
    if (!readable.includes(args.contentType)) {
      return errorResult(unavailableTypeMessage(args.contentType, readable));
    }
    return aggregateOneType(strapi, args.contentType, args, checkerFor);
  },
});
