import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { adminUserIdOf, loadOwned, unauthorized } from '../lib/admin-ownership';

/**
 * Memories, scoped to the admin user they are about.
 *
 * Ported from the reference plugin's `controllers/memory.ts`, with the
 * ownership check moved into `lib/admin-ownership` so the three per-user
 * controllers cannot drift apart on the one rule that matters.
 *
 * There is no `create` from the panel in the reference, and there is one here:
 * the model saves memories on its own, but a person who reads what it recorded
 * about them should be able to add a fact themselves rather than having to
 * phrase a sentence that provokes the model into saving it.
 */

const CONTENT_TYPE = 'plugin::tanstack-ai.memory' as const;
const LABEL = 'Memory';

const memoryController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async find(ctx: Context) {
    const adminUserId = adminUserIdOf(ctx);
    if (!adminUserId) return unauthorized(ctx);

    const memories = await strapi.documents(CONTENT_TYPE).findMany({
      filters: { adminUserId },
      fields: ['content', 'category', 'createdAt'],
      sort: { createdAt: 'desc' },
    });

    ctx.body = { data: memories };
  },

  async create(ctx: Context) {
    const adminUserId = adminUserIdOf(ctx);
    if (!adminUserId) return unauthorized(ctx);

    const { content, category } = ctx.request.body as { content?: string; category?: string };
    if (typeof content !== 'string' || content.trim().length === 0) {
      ctx.status = 400;
      ctx.body = { error: 'content is required' };
      return;
    }

    const memory = await strapi.documents(CONTENT_TYPE).create({
      data: { content, category: category || 'general', adminUserId },
    });

    ctx.status = 201;
    ctx.body = { data: memory };
  },

  async update(ctx: Context) {
    if (!(await loadOwned(strapi, ctx, CONTENT_TYPE, LABEL))) return;

    const { content, category } = ctx.request.body as { content?: string; category?: string };
    const data: Record<string, unknown> = {};
    if (content !== undefined) data.content = content;
    if (category !== undefined) data.category = category;

    const memory = await strapi.documents(CONTENT_TYPE).update({
      documentId: ctx.params.id,
      data: data as never,
    });

    ctx.body = { data: memory };
  },

  async delete(ctx: Context) {
    if (!(await loadOwned(strapi, ctx, CONTENT_TYPE, LABEL))) return;

    await strapi.documents(CONTENT_TYPE).delete({ documentId: ctx.params.id });

    ctx.status = 200;
    ctx.body = { data: { documentId: ctx.params.id } };
  },
});

export default memoryController;
