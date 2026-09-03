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
   * What the admin panel needs to decide what to render.
   *
   * Registered unconditionally, unlike /chat — the admin has to be able to ASK
   * whether chat is on, and a 404 is a worse answer than `enabled: false`
   * because it is indistinguishable from the plugin being broken.
   *
   * Deliberately does not return apiKey or baseURL. The panel needs to know
   * WHETHER chat works and which model answers, not the credential.
   */
  async config(ctx: Context) {
    const config = readConfig(strapi);
    ctx.body = {
      chat: {
        enabled: config.chat.enabled,
        provider: config.chat.provider,
        model: config.chat.model,
      },
    };
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
