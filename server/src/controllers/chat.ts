import { Readable } from 'node:stream';
import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { PLUGIN_NAME } from '../lib/tool-permissions';
import { readConfig } from '../lib/plugin-config';
import type { ChatMessage } from '../services/chat';

/**
 * POST /tanstack-ai/chat — stream an answer into the admin panel.
 *
 * Registered only when `chat.enabled` (see routes/admin), so reaching this
 * handler at all means chat is on.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Whether chat is on. Nothing else.
   *
   * UNAUTHENTICATED, deliberately, and that is the reason it returns one
   * boolean. The admin decides whether to render the menu link during
   * `register()`, which runs before anyone has logged in — so an authenticated
   * endpoint cannot answer the question at the moment it is asked.
   *
   * What it discloses is a boolean that is already visible as the presence or
   * absence of a menu item. Provider, model and credential are NOT here: those
   * are worth a session, and the panel learns the model from the stream's own
   * metadata once a turn runs.
   */
  async config(ctx: Context) {
    ctx.body = { chat: { enabled: readConfig(strapi).chat.enabled } };
  },

  async chat(ctx: Context) {
    const body = ctx.request.body as { messages?: unknown; system?: unknown };

    // Validate before touching the model: a bad request should cost nothing
    // and say what was wrong, not fail somewhere inside a provider call.
    if (!Array.isArray(body?.messages)) {
      return ctx.badRequest('messages must be an array of { role, content }');
    }
    const messages = body.messages.filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === 'object' &&
        ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
        typeof (m as ChatMessage).content === 'string',
    );
    if (messages.length === 0) {
      return ctx.badRequest('messages contained no usable user or assistant turns');
    }

    let response: Response;
    try {
      response = await strapi
        .plugin(PLUGIN_NAME)
        .service('chat')
        .stream(messages, {
          ...(typeof body.system === 'string' ? { system: body.system } : {}),
          // RBAC: the model sees only the tools this admin's role grants,
          // evaluated with the same per-tool actions that gate /mcp.
          ...(ctx.state?.userAbility ? { ability: ctx.state.userAbility } : {}),
        });
    } catch (error) {
      // A missing optional peer, a bad credential, an unreachable Ollama. The
      // message from the seam already says what to do, so pass it through
      // rather than replacing it with a generic 500 — the operator is the
      // person who can fix it.
      const message = error instanceof Error ? error.message : String(error);
      strapi.log.error(`[${PLUGIN_NAME}] chat failed: ${message}`);
      return ctx.internalServerError(message);
    }

    if (!response.body) {
      return ctx.internalServerError('the model returned no stream');
    }

    ctx.status = 200;
    ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
    // `no-transform` as well as `no-cache`: a proxy that "helpfully" compresses
    // or rewrites the body will buffer it, and the stream arrives all at once
    // at the end, which looks like the model being slow rather than a proxy.
    ctx.set('Cache-Control', 'no-cache, no-transform');
    ctx.set('Connection', 'keep-alive');
    // nginx buffers proxied responses by default; this is the opt-out.
    ctx.set('X-Accel-Buffering', 'no');

    // Koa cannot take a Web ReadableStream. The SDK returns a web `Response`,
    // so the body has to be adapted to a Node stream or Koa serialises the
    // object and the client receives "{}".
    ctx.body = Readable.fromWeb(response.body as never);
  },
});
