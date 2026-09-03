import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { readStoredMessages, toStoredMessages } from '../lib/stored-messages';

/**
 * Chat history, scoped to the admin user who wrote it.
 *
 * Ported from the reference plugin's `controllers/conversation.ts`. The shape
 * that matters is the ownership check, repeated on every operation that names
 * a row: load it, compare `adminUserId`, and answer 404 — NOT 403 — when it
 * belongs to someone else. 403 would confirm the row exists, which is a
 * disclosure in itself; 404 says only that this user has no such conversation,
 * which is true.
 *
 * `find` returns titles and timestamps WITHOUT messages, because the sidebar
 * only needs those and a list that carried every transcript would grow
 * unboundedly with history.
 */

const CONTENT_TYPE = 'plugin::tanstack-ai.conversation' as const;

/** The calling admin, or null if the session carries none. */
function adminUserIdOf(ctx: Context): number | null {
  const id = ctx.state?.user?.id;
  return typeof id === 'number' ? id : null;
}

function unauthorized(ctx: Context): void {
  ctx.status = 401;
  ctx.body = { error: 'Unauthorized' };
}

function notFound(ctx: Context): void {
  ctx.status = 404;
  ctx.body = { error: 'Conversation not found' };
}

const conversationController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async find(ctx: Context) {
    const adminUserId = adminUserIdOf(ctx);
    if (!adminUserId) return unauthorized(ctx);

    const conversations = await strapi.documents(CONTENT_TYPE).findMany({
      filters: { adminUserId },
      fields: ['title', 'createdAt', 'updatedAt'],
      sort: { updatedAt: 'desc' },
    });

    ctx.body = { data: conversations };
  },

  async findOne(ctx: Context) {
    const adminUserId = adminUserIdOf(ctx);
    if (!adminUserId) return unauthorized(ctx);

    const conversation = await strapi
      .documents(CONTENT_TYPE)
      .findOne({ documentId: ctx.params.id });

    if (!conversation || conversation.adminUserId !== adminUserId) return notFound(ctx);

    const { messages, error } = readStoredMessages(conversation.messages);
    if (error) {
      // Total by design: return the conversation empty rather than failing the
      // request, and say so here so a damaged row is visible rather than
      // silently blank.
      strapi.log.warn(
        `[tanstack-ai] conversation ${ctx.params.id} has unreadable messages (${error}); ` +
          'returning it empty. The stored value is left untouched.',
      );
    }

    ctx.body = { data: { ...conversation, messages } };
  },

  async create(ctx: Context) {
    const adminUserId = adminUserIdOf(ctx);
    if (!adminUserId) return unauthorized(ctx);

    const { title, messages } = ctx.request.body as { title?: string; messages?: unknown };

    const stored = toStoredMessages(messages ?? []);
    if (!stored.ok) {
      ctx.status = 400;
      ctx.body = { error: `Invalid messages payload — ${stored.error}` };
      return;
    }

    const conversation = await strapi.documents(CONTENT_TYPE).create({
      data: { title: title || 'New conversation', messages: stored.value, adminUserId },
    });

    ctx.status = 201;
    ctx.body = { data: conversation };
  },

  async update(ctx: Context) {
    const adminUserId = adminUserIdOf(ctx);
    if (!adminUserId) return unauthorized(ctx);

    const existing = await strapi
      .documents(CONTENT_TYPE)
      .findOne({ documentId: ctx.params.id });
    if (!existing || existing.adminUserId !== adminUserId) return notFound(ctx);

    const { title, messages } = ctx.request.body as { title?: string; messages?: unknown };
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;

    if (messages !== undefined) {
      const stored = toStoredMessages(messages);
      if (!stored.ok) {
        ctx.status = 400;
        ctx.body = { error: `Invalid messages payload — ${stored.error}` };
        return;
      }
      data.messages = stored.value;
    }

    const conversation = await strapi.documents(CONTENT_TYPE).update({
      documentId: ctx.params.id,
      data: data as never,
    });

    ctx.body = { data: conversation };
  },

  async delete(ctx: Context) {
    const adminUserId = adminUserIdOf(ctx);
    if (!adminUserId) return unauthorized(ctx);

    const existing = await strapi
      .documents(CONTENT_TYPE)
      .findOne({ documentId: ctx.params.id });
    if (!existing || existing.adminUserId !== adminUserId) return notFound(ctx);

    await strapi.documents(CONTENT_TYPE).delete({ documentId: ctx.params.id });

    ctx.status = 200;
    ctx.body = { data: { documentId: ctx.params.id } };
  },
});

export default conversationController;
