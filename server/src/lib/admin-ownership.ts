import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';

/**
 * The ownership rule for this plugin's per-user rows, in one place.
 *
 * The reference plugin repeats this check inline in every controller method —
 * load the row, compare `adminUserId`, answer 404. That is fine when there is
 * one controller; with conversations, memories and notes it becomes fifteen
 * copies of a check whose ONLY failure mode is being forgotten in one of them,
 * and the symptom of forgetting is one admin reading another's data.
 *
 * The rule itself is carried over unchanged, including the part that looks
 * like a mistake: a row that exists but belongs to someone else answers
 * **404, not 403**. 403 would confirm the row exists, which is a disclosure in
 * itself. 404 says only that this user has no such row, which is true.
 */

/** The calling admin, or null when the session carries none. */
export function adminUserIdOf(ctx: Context): number | null {
  const id = ctx.state?.user?.id;
  return typeof id === 'number' ? id : null;
}

export function unauthorized(ctx: Context): void {
  ctx.status = 401;
  ctx.body = { error: 'Unauthorized' };
}

export function notFound(ctx: Context, what: string): void {
  ctx.status = 404;
  ctx.body = { error: `${what} not found` };
}

/**
 * Load a row this admin owns, or answer the request and return null.
 *
 * Returning null after having ALREADY written the response is deliberate: it
 * makes the caller's shape `if (!row) return;`, so a forgotten check reads as
 * obviously missing rather than as a subtly absent condition.
 */
export async function loadOwned<T extends { adminUserId?: number }>(
  strapi: Core.Strapi,
  ctx: Context,
  contentType: string,
  label: string,
): Promise<T | null> {
  const adminUserId = adminUserIdOf(ctx);
  if (!adminUserId) {
    unauthorized(ctx);
    return null;
  }

  const row = (await strapi
    .documents(contentType as never)
    .findOne({ documentId: ctx.params.id })) as unknown as T | null;

  if (!row || row.adminUserId !== adminUserId) {
    notFound(ctx, label);
    return null;
  }

  return row;
}
