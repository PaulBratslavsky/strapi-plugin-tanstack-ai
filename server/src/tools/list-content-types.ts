import { ai } from '@strapi/strapi';
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { actionForTool } from '../lib/tool-permissions';

/**
 * `list_content_types` — what does this Strapi actually hold, and how?
 *
 * WHY THIS TOOL EXISTS. Strapi's official MCP server publishes tools PER
 * CONTENT TYPE: `list_article`, `get_article`, `create_article`. That is right
 * for "show me article 3" and structurally unable to answer "what kinds of
 * things do you store?" — a model can only call `list_article` if it already
 * knows an `article` exists. Every cross-type question starts here.
 *
 * WHY IT REPORTS CONSTRAINTS, NOT JUST NAMES. Prior art from the reference
 * plugin, and its reasoning is worth repeating: a model told only that
 * `description` exists will send 90 characters to a field capped at 80, and
 * the only feedback is a rejected write it has to guess its way out of. Strong
 * models absorb that round trip; smaller ones spend their single attempt on it
 * and either give up or report a save that never happened. Constraints are
 * cheap to send and expensive to omit.
 */

/** A field, with everything needed to write it correctly the first time. */
const FieldSummary = z.object({
  name: z.string(),
  type: z.string().describe('Strapi attribute type: string, richtext, integer, media…'),
  required: z.boolean().optional(),
  maxLength: z.number().optional(),
  minLength: z.number().optional(),
  enum: z.array(z.string()).optional(),
  default: z.unknown().optional(),
});

/** A relation, separated from ordinary fields because it is traversable. */
const RelationSummary = z.object({
  field: z.string(),
  kind: z.string().describe('oneToMany, manyToOne, oneToOne, manyToMany.'),
  target: z.string().describe('uid of the related type — pass it back to this tool to inspect it.'),
});

const ContentTypeSummary = z.object({
  uid: z.string().describe('Stable identifier, e.g. "api::article.article". Use this in other tools.'),
  kind: z.string().describe('"collectionType" for many entries, "singleType" for exactly one.'),
  displayName: z.string(),
  fields: z.array(FieldSummary),
  relations: z.array(RelationSummary),
  components: z.array(z.string()).describe('Component uids embedded in this type.'),
});

type Attr = Record<string, unknown>;

/**
 * Derived from the schema rather than written twice.
 *
 * These summaries are BUILT dynamically — constraints are attached only when
 * an attribute sets them — so without this the inferred type is
 * `Record<string, unknown>` and nothing checks that what the handler produces
 * matches what the tool advertises.
 */
type Field = z.infer<typeof FieldSummary>;
type Relation = z.infer<typeof RelationSummary>;

/**
 * The handler's return type, stated rather than inferred.
 *
 * The SDK's return union distinguishes the two branches with
 * `structuredContent?: never` on the error side. Inferring across two return
 * statements gives that property the type `undefined` instead — assignable to
 * almost anything except `never` — so the whole handler fails to match. Naming
 * the type once makes both branches check against it directly.
 */
type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;

const outputSchema = () =>
  z.object({
    contentTypes: z.array(ContentTypeSummary),
    count: z.number(),
  });

/**
 * Constraints, omitted when absent.
 *
 * A field that sets nothing costs two keys rather than eight. Across a large
 * schema that is the difference between a listing a model can hold in context
 * and one that crowds out the question.
 */
function toField(name: string, attr: Attr): Field {
  const field: Field = { name, type: String(attr.type ?? 'unknown') };
  if (attr.required === true) field.required = true;
  if (typeof attr.maxLength === 'number') field.maxLength = attr.maxLength;
  if (typeof attr.minLength === 'number') field.minLength = attr.minLength;
  if (Array.isArray(attr.enum)) field.enum = attr.enum;
  if (attr.default !== undefined) field.default = attr.default;
  return field;
}

function summarize(ct: { uid: string; kind?: string; info?: { displayName?: string }; attributes?: Record<string, Attr> }) {
  const fields: Field[] = [];
  const relations: Relation[] = [];
  const components = new Set<string>();

  for (const [name, attr] of Object.entries(ct.attributes ?? {})) {
    if (attr.type === 'relation' && typeof attr.target === 'string') {
      relations.push({ field: name, kind: String(attr.relation ?? 'unknown'), target: attr.target });
      continue;
    }
    if (attr.type === 'component' && typeof attr.component === 'string') {
      components.add(attr.component);
    }
    if (attr.type === 'dynamiczone' && Array.isArray(attr.components)) {
      for (const c of attr.components) components.add(String(c));
    }
    fields.push(toField(name, attr));
  }

  return {
    uid: ct.uid,
    kind: ct.kind ?? 'collectionType',
    displayName: ct.info?.displayName ?? ct.uid,
    fields,
    relations,
    components: [...components],
  };
}

export const listContentTypes = ai.mcp.defineTool({
  name: 'list_content_types',
  title: 'TanStack AI: List Content Types',
  description:
    'List the content types in this Strapi with their fields, constraints, relations and components. ' +
    'Call this first when you do not already know what content exists — it returns the uids the ' +
    'per-type tools need. Each field reports the constraints it carries (required, maxLength, enum, ' +
    'default); respect them when writing, because a violation is rejected. Pass `uid` to inspect a ' +
    'single type, which is far smaller than the full listing.',

  // Gated behind THIS PLUGIN's own action, deliberately subject-less.
  //
  // Borrowing `plugin::content-manager.explorer.read` does not work and fails
  // invisibly: those grants are scoped to a specific content type, and Strapi's
  // session gate calls `ability.can(action)` with no subject when the policy
  // omits one. See lib/tool-permissions.ts for the full reasoning.
  auth: { policies: [{ action: actionForTool('list_content_types') }] },

  resolveInputSchema: () =>
    z.object({
      uid: z
        .string()
        .optional()
        .describe('Return only this content type, e.g. "api::article.article". Omit to list all.'),
    }),

  resolveOutputSchema: outputSchema,

  createHandler: (strapi: Core.Strapi) => async ({ args }): Promise<ToolResult> => {
    // `api::` only. Strapi's registry also holds admin::, plugin:: and
    // strapi:: internals — users, permissions, locales, upload files. Those
    // are implementation detail, and listing them invites a model to go poking
    // at the admin schema instead of the content it was asked about.
    const all = Object.values(strapi.contentTypes).filter((ct) => ct.uid.startsWith('api::'));

    const requested = args.uid;
    const selected = requested ? all.filter((ct) => ct.uid === requested) : all;

    // An unknown uid uses the protocol's OWN error branch — `isError` with no
    // structuredContent — rather than a success payload carrying an `error`
    // key. The union in McpToolHandlerReturn makes the two mutually exclusive
    // on purpose: a client that trusts structuredContent should never receive
    // a failure dressed as data.
    //
    // The message lists what IS available, so a model that guessed wrong can
    // retry immediately instead of calling the tool again with no argument.
    if (requested && selected.length === 0) {
      const known = all.map((ct) => ct.uid).join(', ');
      return {
        content: [
          {
            type: 'text' as const,
            text: `No content type "${requested}". Available: ${known || '(none)'}`,
          },
        ],
        isError: true as const,
      };
    }

    const contentTypes = selected.map(summarize);
    const result = { contentTypes, count: contentTypes.length };

    // Both shapes are required: `content` is what a client without structured
    // output support renders, `structuredContent` is what a model consumes.
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
});
