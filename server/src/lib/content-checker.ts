import type { Core } from '@strapi/strapi';
import { createReadCheckers, type ReadChecker, type UserAbility } from './read-permissions';

/**
 * Content Manager's permission checker, typed for writes as well as reads.
 *
 * SAME OBJECT, WIDER VIEW. `createReadCheckers` already returns the real
 * checker from content-manager; `ReadChecker` just names the read half of it.
 * The write tools need the rest, so this re-types the same factory rather
 * than building a second one that could drift from it.
 *
 * The model is Strapi's own built-in MCP handlers
 * (@strapi/content-manager/dist/server/mcp/handlers/collection-handlers.js):
 * `cannot.<action>()` before touching anything, `sanitize*Input` on the way
 * in, `sanitizeOutput` on the way out, and `cannot.<action>(entity)` once the
 * entity is known so permission CONDITIONS ("only mine") apply.
 */
type Entity = Record<string, unknown>;

export interface ContentChecker extends ReadChecker {
  cannot: ReadChecker['cannot'] & {
    read: (entity?: Entity) => boolean;
    create: () => boolean;
    update: (entity?: Entity) => boolean;
    publish: (entity?: Entity) => boolean;
  };
  sanitizeCreateInput: (data: Entity) => Promise<Entity>;
  sanitizeUpdateInput: (entity: Entity) => (data: Entity) => Promise<Entity>;
}

export function createContentCheckers(
  strapi: Core.Strapi,
  userAbility: UserAbility,
): (uid: string) => ContentChecker {
  return createReadCheckers(strapi, userAbility) as unknown as (uid: string) => ContentChecker;
}
