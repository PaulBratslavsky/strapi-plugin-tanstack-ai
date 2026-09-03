import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { adminUserIdOf, loadOwned, unauthorized } from '../lib/admin-ownership';

/**
 * Research notes, scoped to the admin user who owns them.
 *
 * Ported from the reference plugin's `controllers/note.ts`, using the shared
 * ownership rule (404 rather than 403 on someone else's row).
 */

const CONTENT_TYPE = 'plugin::tanstack-ai.note' as const;
const LABEL = 'Note';

/** The fields a note carries, as the panel sends them. */
interface NoteBody {
  title?: string;
  content?: string;
  category?: string;
  tags?: string;
  source?: string;
}

const noteController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async find(ctx: Context) {
    const adminUserId = adminUserIdOf(ctx);
    if (!adminUserId) return unauthorized(ctx);

    const notes = await strapi.documents(CONTENT_TYPE).findMany({
      filters: { adminUserId },
      fields: ['title', 'content', 'category', 'tags', 'source', 'createdAt'],
      sort: { createdAt: 'desc' },
    });

    ctx.body = { data: notes };
  },

  async create(ctx: Context) {
    const adminUserId = adminUserIdOf(ctx);
    if (!adminUserId) return unauthorized(ctx);

    const body = ctx.request.body as NoteBody;
    if (typeof body.content !== 'string' || body.content.trim().length === 0) {
      ctx.status = 400;
      ctx.body = { error: 'content is required' };
      return;
    }

    const note = await strapi.documents(CONTENT_TYPE).create({
      data: {
        title: body.title || '',
        content: body.content,
        category: body.category || 'research',
        tags: body.tags || '',
        source: body.source || 'admin panel',
        adminUserId,
      },
    });

    ctx.status = 201;
    ctx.body = { data: note };
  },

  async update(ctx: Context) {
    if (!(await loadOwned(strapi, ctx, CONTENT_TYPE, LABEL))) return;

    const body = ctx.request.body as NoteBody;
    const data: Record<string, unknown> = {};
    for (const key of ['title', 'content', 'category', 'tags', 'source'] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }

    const note = await strapi.documents(CONTENT_TYPE).update({
      documentId: ctx.params.id,
      data: data as never,
    });

    ctx.body = { data: note };
  },

  async delete(ctx: Context) {
    if (!(await loadOwned(strapi, ctx, CONTENT_TYPE, LABEL))) return;

    await strapi.documents(CONTENT_TYPE).delete({ documentId: ctx.params.id });

    ctx.status = 200;
    ctx.body = { data: { documentId: ctx.params.id } };
  },
});

export default noteController;
