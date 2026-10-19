import { ai } from '@strapi/strapi';
import { setCreatorFields, z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { actionForTool } from '../lib/tool-permissions';
import { jsonCoercible } from '../lib/json-coercible';
import { abilityFrom, readableContentTypes } from '../lib/read-permissions';
import { createContentCheckers } from '../lib/content-checker';
import { errorResult, okResult } from './results';

/**
 * `create_content`: a new document in any content type the caller may create in.
 *
 * Ported from strapi-plugin-ai-chat, which created with no caller check at
 * all. Here it mirrors Strapi's own `create_<type>` MCP handler: refuse
 * without Create, sanitise the input for Create (drops fields the caller may
 * not write), stamp createdBy/updatedBy so "only mine" conditions work later,
 * and return the row through the READ sanitiser (a caller can hold Create
 * without Read).
 */
const outputSchema = () =>
  z.object({
    contentType: z.string(),
    documentId: z.string().optional(),
    data: z.record(z.string(), z.unknown()),
  });

type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;

/** The caller's admin id, or undefined. The chat passes id 0 when it has none. */
export const callerId = (context: unknown): number | undefined => {
  const id = (context as { user?: { id?: unknown } } | undefined)?.user?.id;
  return typeof id === 'number' && id > 0 ? id : undefined;
};

export const createContent = ai.mcp.defineTool({
  name: 'create_content',
  title: 'TanStack AI: Create Content',
  description:
    'Create a new document in any content type you are allowed to create in. Requires contentType ' +
    '(call list_content_types for uids and fields) and data. Saved as a draft unless you pass ' +
    'status "published", which needs Publish permission. To attach media, upload it with ' +
    'upload_media first and pass the returned file id in data.',

  auth: { policies: [{ action: actionForTool('create_content') }] },

  resolveInputSchema: () =>
    z.object({
      contentType: z.string().describe('e.g. "api::article.article".'),
      data: jsonCoercible(z.record(z.string(), z.unknown())).describe('Field values matching the schema.'),
      status: z.enum(['draft', 'published']).optional().describe('Default draft.'),
      locale: z.string().optional().describe('i18n locale, e.g. "en".'),
    }),

  resolveOutputSchema: outputSchema,

  createHandler: (strapi: Core.Strapi, context) => async ({ args }): Promise<ToolResult> => {
    const userAbility = abilityFrom(context);
    if (!userAbility) {
      return errorResult("create_content could not determine the caller's permissions, so it created nothing.");
    }
    const checkerFor = createContentCheckers(strapi, userAbility);
    const { displayed } = readableContentTypes(strapi, checkerFor);
    const creatable = displayed.filter((uid) => !checkerFor(uid).cannot.create());
    if (!creatable.includes(args.contentType)) {
      return errorResult(
        `You cannot create entries in "${args.contentType}". You can create in: ${creatable.join(', ') || '(none)'}`,
      );
    }
    const checker = checkerFor(args.contentType);

    if (args.status === 'published' && checker.cannot.publish()) {
      return errorResult(
        `You may create drafts in ${args.contentType} but not publish them. Retry without status "published".`,
      );
    }

    const sanitized = await checker.sanitizeCreateInput(args.data);
    const id = callerId(context);
    const data = id ? setCreatorFields({ user: { id } })(sanitized) : sanitized;

    const doc = (await strapi.documents(args.contentType as never).create({
      data,
      ...(args.status ? { status: args.status } : {}),
      ...(args.locale ? { locale: args.locale } : {}),
      populate: '*',
    } as never)) as Record<string, unknown>;

    const visible = await checker.sanitizeOutput(doc);
    return okResult({
      contentType: args.contentType,
      ...(typeof doc.documentId === 'string' ? { documentId: doc.documentId } : {}),
      data: visible,
    });
  },
});
