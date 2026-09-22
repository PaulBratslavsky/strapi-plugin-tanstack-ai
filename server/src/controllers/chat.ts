import { Readable } from 'node:stream';
import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { PLUGIN_NAME } from '../lib/tool-permissions';
import { readConfig } from '../lib/plugin-config';
import { currentChatStatus } from '../lib/chat-status';
import type { ChatMessage } from '../services/chat';

/**
 * POST /tanstack-ai/chat — stream an answer into the admin panel.
 *
 * Registered only when the config can run chat (see routes/admin). Bootstrap's
 * probe can still find an optional package missing, so the handler checks.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Whether chat can run, and if not, what to change.
   *
   * UNAUTHENTICATED, and kept that small on purpose. The chat page reads it to
   * decide between the chat and a setup notice. `reason` names a setting or a
   * package to install ("Set chat.apiKey…", "npm install @tanstack/ai") — it
   * never carries the provider, model or any credential value.
   *
   * `enabled` keeps its old meaning (what the config asked for) so a 1.2.x
   * admin bundle reading it still behaves.
   */
  async config(ctx: Context) {
    ctx.body = { chat: currentChatStatus(readConfig(strapi).chat) };
  },

  async chat(ctx: Context) {
    const body = ctx.request.body as {
      messages?: unknown;
      system?: unknown;
      enabledToolSources?: unknown;
      forwardedProps?: { enabledToolSources?: unknown };
    };

    /**
     * The panel's tool-source selection.
     *
     * Read from `forwardedProps` FIRST, because that is where the SDK puts
     * caller-supplied fields — a top-level key would have been dropped
     * silently, and the symptom is a picker whose toggles do nothing. The
     * top-level fallback keeps a plain HTTP client (curl, a test) able to send
     * it without knowing the SDK's envelope.
     */
    const requestedSources = Array.isArray(body.forwardedProps?.enabledToolSources)
      ? body.forwardedProps.enabledToolSources
      : body.enabledToolSources;

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

    // The route exists whenever the config can run chat, but bootstrap's probe
    // may since have found an optional package missing. Say so, rather than
    // failing inside the SDK loader mid-request.
    const status = currentChatStatus(readConfig(strapi).chat);
    if (!status.ready) {
      ctx.status = 503;
      ctx.body = { error: { status: 503, name: 'ChatNotReady', message: status.reason } };
      return;
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
          // Identity, which is a different question from permission: it is
          // what makes memories belong to somebody. Without it the memory
          // tools are not offered at all, rather than writing rows with no
          // owner.
          ...(typeof ctx.state?.user?.id === 'number'
            ? { adminUserId: ctx.state.user.id }
            : {}),
          // Absent means "not stated" and offers all of them; an empty array
          // means the user turned them all off, which is a different thing.
          ...(Array.isArray(requestedSources)
            ? { enabledToolSources: requestedSources.filter((s) => typeof s === 'string') }
            : {}),
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
