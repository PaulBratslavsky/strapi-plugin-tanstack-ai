import type { Core } from '@strapi/strapi';
import { contentTypes } from '@strapi/utils';
import { abilityFrom, createReadCheckers, displayedContentTypes, type ReadChecker, type UserAbility } from './read-permissions';

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
  sanitizedQuery: ReadChecker['sanitizedQuery'] & {
    update: (query: Entity) => Promise<Entity>;
    publish: (query: Entity) => Promise<Entity>;
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

/** Whether the type has draft and publish. Without it there is nothing to publish and `status` means nothing. */
export const hasDraftAndPublish = (strapi: Core.Strapi, uid: string): boolean =>
  contentTypes.hasDraftAndPublish(strapi.getModel(uid as never) as never);

const GATE_TEXT = {
  create: { done: 'created', refuse: 'create entries in', list: 'create in' },
  update: { done: 'changed', refuse: 'update entries in', list: 'update' },
} as const;

/**
 * The gate every write tool opens with: who is the caller, and may they write
 * to this type at all.
 *
 * Offers only types Content Manager displays and the caller holds `action` on,
 * so the refusal can list what would have worked. The text is the same whether
 * the type is missing, hidden or merely not granted, for the reason given on
 * `unavailableTypeMessage`.
 */
export function gateWrite(
  strapi: Core.Strapi,
  context: unknown,
  uid: string,
  action: 'create' | 'update',
): { refusal: string } | { checker: ContentChecker } {
  const text = GATE_TEXT[action];
  const userAbility = abilityFrom(context);
  if (!userAbility) {
    return { refusal: `${action}_content could not determine the caller's permissions, so it ${text.done} nothing.` };
  }
  const checkerFor = createContentCheckers(strapi, userAbility);
  const allowed = displayedContentTypes(strapi).filter((candidate) => !checkerFor(candidate).cannot[action]());
  if (!allowed.includes(uid)) {
    return { refusal: `You cannot ${text.refuse} "${uid}". You can ${text.list}: ${allowed.join(', ') || '(none)'}` };
  }
  return { checker: checkerFor(uid) };
}

/**
 * Load a document's DRAFT with what the permission conditions read.
 *
 * Without the populate the draft arrives with no `createdBy`, so an "is
 * creator" condition refuses the caller on their OWN documents. Strapi's
 * built-in handlers do the same: build the permission query for the action,
 * turn it into a populate with content-manager's populate-builder, then load.
 */
export async function loadDraftForPermission(
  strapi: Core.Strapi,
  checker: ContentChecker,
  uid: string,
  action: 'update' | 'publish',
  documentId: string,
  locale?: string,
): Promise<Record<string, unknown> | null> {
  const permissionQuery = await checker.sanitizedQuery[action]({ ...(locale ? { locale } : {}) });
  const populateBuilder = strapi.plugin('content-manager').service('populate-builder') as unknown as (uid: string) => {
    populateFromQuery: (query: unknown) => { build: () => Promise<unknown> };
  };
  const populate = await populateBuilder(uid).populateFromQuery(permissionQuery).build();
  return (await strapi.documents(uid as never).findOne({
    documentId,
    status: 'draft',
    populate,
    ...(locale ? { locale } : {}),
  } as never)) as Record<string, unknown> | null;
}
