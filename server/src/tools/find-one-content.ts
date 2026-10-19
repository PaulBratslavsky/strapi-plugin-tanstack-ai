import { ai } from '@strapi/strapi';
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { actionForTool } from '../lib/tool-permissions';
import { jsonCoercible } from '../lib/json-coercible';
import { abilityFrom, readableContentTypes, unavailableTypeMessage } from '../lib/read-permissions';
import { createContentCheckers } from '../lib/content-checker';
import { errorResult, okResult } from './results';

/**
 * `find_one_content`: one document by its exact documentId.
 *
 * Ported from strapi-plugin-ai-chat, which returned the row through the
 * content-API sanitiser with no caller at all. Here it reads AS THE CALLER:
 * the documentId filter goes through `sanitizedQuery.read`, so a permission
 * condition ("only entries I created") becomes part of the query, and the row
 * comes back through `sanitizeOutput`. Same model as Strapi's own
 * `get_<type>` handler.
 */
const outputSchema = () =>
  z.object({
    contentType: z.string(),
    documentId: z.string(),
    data: z.record(z.string(), z.unknown()),
  });

type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;

export const findOneContent = ai.mcp.defineTool({
  name: 'find_one_content',
  title: 'TanStack AI: Find One Content',
  description:
    'Fetch ONE document by its exact documentId, with its relations populated. Use it once ' +
    'search_content (or a per-type list tool) has given you the documentId. Fields and relations ' +
    'you cannot read in Content Manager are left out. Requires contentType and documentId.',

  auth: { policies: [{ action: actionForTool('find_one_content') }] },

  resolveInputSchema: () =>
    z.object({
      contentType: z.string().describe('e.g. "api::article.article". Call list_content_types if unsure.'),
      documentId: z.string().describe('The documentId, e.g. from search_content.'),
      fields: jsonCoercible(z.array(z.string())).optional().describe('Return only these fields.'),
      status: z.enum(['draft', 'published']).optional().describe('Draft is the default for draft-and-publish types.'),
      locale: z.string().optional().describe('i18n locale, e.g. "en".'),
    }),

  resolveOutputSchema: outputSchema,

  createHandler: (strapi: Core.Strapi, context) => async ({ args }): Promise<ToolResult> => {
    const userAbility = abilityFrom(context);
    if (!userAbility) {
      return errorResult("find_one_content could not determine the caller's permissions, so it read nothing.");
    }
    const checkerFor = createContentCheckers(strapi, userAbility);
    const { readable } = readableContentTypes(strapi, checkerFor);
    if (!readable.includes(args.contentType)) {
      return errorResult(unavailableTypeMessage(args.contentType, readable));
    }
    const checker = checkerFor(args.contentType);

    const permitted = await checker.sanitizedQuery.read({
      filters: { documentId: { $eq: args.documentId } },
      ...(args.fields ? { fields: args.fields } : {}),
      populate: '*',
    });

    const doc = (await strapi.documents(args.contentType as never).findFirst({
      ...permitted,
      ...(args.status ? { status: args.status } : {}),
      ...(args.locale ? { locale: args.locale } : {}),
    } as never)) as Record<string, unknown> | null;

    // ONE answer for "missing" and "exists but not yours": see Review Focus 2.
    if (!doc || checker.cannot.read(doc)) {
      return errorResult(`No document "${args.documentId}" in ${args.contentType} that you can read.`);
    }

    return okResult({
      contentType: args.contentType,
      documentId: args.documentId,
      data: await checker.sanitizeOutput(doc),
    });
  },
});
