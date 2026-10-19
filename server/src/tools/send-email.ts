import { ai } from '@strapi/strapi';
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { actionForTool } from '../lib/tool-permissions';
import { errorResult, okResult } from './results';

/**
 * `send_email`: send through the host's configured email provider.
 *
 * Ported from strapi-plugin-ai-chat. Gated only by this tool's own action:
 * there is no Content Manager permission for "send mail", so the action IS
 * the authorisation. Grant it deliberately. Failures come back as `isError`
 * rather than ai-chat's `success: false` data, so the chat surfaces them as
 * failures instead of narrating them as results.
 */
const outputSchema = () => z.object({ sent: z.literal(true), to: z.string(), subject: z.string() });
type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;

const DOMAIN_HINT =
  ' This usually means the sending domain is not verified with the email provider (for Resend, ' +
  'test mode only delivers to the account owner). Verify the domain to send to any recipient.';

export const sendEmail = ai.mcp.defineTool({
  name: 'send_email',
  title: 'TanStack AI: Send Email',
  description:
    'Send an email through the configured email provider, body as HTML. BEFORE calling, confirm ' +
    'the exact recipient address with the user by repeating it back and getting explicit approval, ' +
    'and confirm the subject and body. Never substitute a default or admin address for the one the ' +
    'user gave.',

  auth: { policies: [{ action: actionForTool('send_email') }] },

  resolveInputSchema: () =>
    z.object({
      to: z.string().describe('Recipient address, exactly as the user gave it.'),
      subject: z.string(),
      html: z.string().describe('Body as HTML.'),
      text: z.string().optional().describe('Plain-text fallback.'),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      replyTo: z.string().optional(),
    }),

  resolveOutputSchema: outputSchema,

  createHandler: (strapi: Core.Strapi) => async ({ args }): Promise<ToolResult> => {
    const email = strapi.plugin('email');
    if (!email) {
      return errorResult('The email plugin is not enabled on this Strapi, so nothing was sent.');
    }
    try {
      await email.service('email').send(args);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const hint = /not allowed|verify|domain|can only send/i.test(detail) ? DOMAIN_HINT : '';
      return errorResult(`Sending to ${args.to} failed: ${detail}.${hint}`);
    }
    return okResult({ sent: true as const, to: args.to, subject: args.subject });
  },
});
