import { ai } from '@strapi/strapi';
import { setCreatorFields, z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { actionForTool } from '../lib/tool-permissions';
import { jsonCoercible } from '../lib/json-coercible';
import { callerId } from '../lib/read-permissions';
import { gateWrite, hasDraftAndPublish, loadDraftForPermission, type ContentChecker } from '../lib/content-checker';
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
 *
 * `status: "published"` on a type with draft and publish is two steps, because
 * the entity-level Publish check ("only mine" conditions) needs the document
 * to exist: refuse at type level before writing, save a DRAFT, check Publish
 * against the saved draft, then publish. If that last check refuses, the draft
 * stays and the result says so. A type without draft and publish has nothing
 * to publish, so `status` is ignored there (as the document service does) and
 * the Publish grant, which the permissions grid only offers on such types, is
 * not consulted.
 */
const outputSchema = () =>
  z.object({
    contentType: z.string(),
    documentId: z.string().optional(),
    data: z.record(z.string(), z.unknown()),
  });

type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;

/**
 * The second half of a "create and publish": check Publish against the draft
 * that was just saved, then publish it. Every refusal says the draft is still
 * there, because the caller asked for one outcome and got another.
 */
async function publishSavedDraft(
  strapi: Core.Strapi,
  checker: ContentChecker,
  uid: string,
  documentId: string,
  locale?: string,
): Promise<{ published?: Record<string, unknown> } | { error: string }> {
  const kept = `The draft WAS saved as documentId "${documentId}" in ${uid} and is still a draft.`;
  const saved = await loadDraftForPermission(strapi, checker, uid, 'publish', documentId, locale);
  if (!saved || checker.cannot.publish(saved)) {
    return { error: `${kept} You may not publish it, so it was not published.` };
  }
  try {
    const result = (await strapi.documents(uid as never).publish({
      documentId,
      ...(locale ? { locale } : {}),
    } as never)) as { entries?: Array<Record<string, unknown>> } | null;
    return { published: result?.entries?.[0] };
  } catch (error) {
    return { error: `${kept} Publishing it failed: ${(error as Error).message}` };
  }
}

export const createContent = ai.mcp.defineTool({
  name: 'create_content',
  title: 'TanStack AI: Create Content',
  description:
    'Create a new document in any content type you are allowed to create in. Requires contentType ' +
    '(call list_content_types for uids and fields) and data. Saved as a draft unless you pass ' +
    'status "published" (on types with draft and publish), which needs Publish permission. ' +
    'To attach media, upload it with upload_media first and pass the returned file id in data.',

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
    const gate = gateWrite(strapi, context, args.contentType, 'create');
    if ('refusal' in gate) return errorResult(gate.refusal);
    const { checker } = gate;

    const publishAfter = args.status === 'published' && hasDraftAndPublish(strapi, args.contentType);
    if (publishAfter && checker.cannot.publish()) {
      return errorResult(
        `You may create drafts in ${args.contentType} but not publish them. Retry without status "published".`,
      );
    }

    const sanitized = await checker.sanitizeCreateInput(args.data);
    const id = callerId(context);
    const data = id ? setCreatorFields({ user: { id } })(sanitized) : sanitized;

    // Always created as a draft (or as the only version, without draft and
    // publish): publishing is a separate, separately checked step below.
    const doc = (await strapi.documents(args.contentType as never).create({
      data,
      ...(args.locale ? { locale: args.locale } : {}),
      populate: '*',
    } as never)) as Record<string, unknown>;
    const documentId = typeof doc.documentId === 'string' ? doc.documentId : undefined;

    let result = doc;
    if (publishAfter && documentId) {
      const outcome = await publishSavedDraft(strapi, checker, args.contentType, documentId, args.locale);
      if ('error' in outcome) return errorResult(outcome.error);
      result = outcome.published ?? doc;
    }

    return okResult({
      contentType: args.contentType,
      ...(documentId ? { documentId } : {}),
      data: await checker.sanitizeOutput(result),
    });
  },
});
