import { ai } from '@strapi/strapi';
import { setCreatorFields, z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { actionForTool } from '../lib/tool-permissions';
import { jsonCoercible } from '../lib/json-coercible';
import { abilityFrom, readableContentTypes } from '../lib/read-permissions';
import { createContentCheckers } from '../lib/content-checker';
import { callerId } from './create-content';
import { errorResult, okResult } from './results';

/**
 * `update_content`: change fields on an existing document.
 *
 * Ported from strapi-plugin-ai-chat (no caller check there). Mirrors Strapi's
 * `update_<type>` handler: refuse without Update, load the DRAFT version, check
 * Update against that entity so conditions apply, sanitise the input for
 * Update, stamp updatedBy, return through the read sanitiser.
 */
const outputSchema = () =>
  z.object({
    contentType: z.string(),
    documentId: z.string(),
    data: z.record(z.string(), z.unknown()),
  });

type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;

export const updateContent = ai.mcp.defineTool({
  name: 'update_content',
  title: 'TanStack AI: Update Content',
  description:
    'Update an existing document in any content type you are allowed to update. Requires ' +
    'contentType, documentId and data with ONLY the fields to change. Typical flow: search_content ' +
    'to find the documentId, then update_content. Pass status "published" to publish the change, ' +
    'which needs Publish permission.',

  auth: { policies: [{ action: actionForTool('update_content') }] },

  resolveInputSchema: () =>
    z.object({
      contentType: z.string().describe('e.g. "api::article.article".'),
      documentId: z.string().describe('The documentId to update.'),
      data: jsonCoercible(z.record(z.string(), z.unknown())).describe('Only the fields to change.'),
      status: z.enum(['draft', 'published']).optional().describe('Default draft.'),
      locale: z.string().optional().describe('i18n locale, e.g. "en".'),
    }),

  resolveOutputSchema: outputSchema,

  createHandler: (strapi: Core.Strapi, context) => async ({ args }): Promise<ToolResult> => {
    const userAbility = abilityFrom(context);
    if (!userAbility) {
      return errorResult("update_content could not determine the caller's permissions, so it changed nothing.");
    }
    const checkerFor = createContentCheckers(strapi, userAbility);
    const { displayed } = readableContentTypes(strapi, checkerFor);
    const updatable = displayed.filter((uid) => !checkerFor(uid).cannot.update());
    if (!updatable.includes(args.contentType)) {
      return errorResult(
        `You cannot update entries in "${args.contentType}". You can update: ${updatable.join(', ') || '(none)'}`,
      );
    }
    const checker = checkerFor(args.contentType);

    const existing = (await strapi.documents(args.contentType as never).findOne({
      documentId: args.documentId,
      status: 'draft',
      ...(args.locale ? { locale: args.locale } : {}),
    } as never)) as Record<string, unknown> | null;

    if (!existing || checker.cannot.update(existing)) {
      return errorResult(`No document "${args.documentId}" in ${args.contentType} that you can update.`);
    }
    if (args.status === 'published' && checker.cannot.publish(existing)) {
      return errorResult(
        `You may update ${args.contentType} but not publish it. Retry without status "published".`,
      );
    }

    const sanitized = await checker.sanitizeUpdateInput(existing)(args.data);
    const id = callerId(context);
    const data = id ? setCreatorFields({ user: { id }, isEdition: true })(sanitized) : sanitized;

    const doc = (await strapi.documents(args.contentType as never).update({
      documentId: args.documentId,
      data,
      ...(args.status ? { status: args.status } : {}),
      ...(args.locale ? { locale: args.locale } : {}),
      populate: '*',
    } as never)) as Record<string, unknown>;

    return okResult({
      contentType: args.contentType,
      documentId: args.documentId,
      data: await checker.sanitizeOutput(doc),
    });
  },
});
