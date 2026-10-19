import { vi } from 'vitest';
import type { Core } from '@strapi/strapi';

/**
 * One fake Strapi for the write tools' tests.
 *
 * It models the parts of content-manager's permission checker those tools
 * route through, at the level the tests care about:
 *   - per-type denials (`deny.create` etc.), which the tools must check first
 *   - per-ENTITY denials: a doc with `ownedByOther: true` fails cannot.read(doc)
 *     and cannot.update(doc), standing in for a condition like "only mine"
 *   - hidden fields, dropped from input and output by the sanitisers
 *   - `sanitizedQuery.read` adding a marker the fake `findFirst` honours, so a
 *     tool that skips the permission query is visible in the test
 * The real sanitisers are Strapi's; Task 8's host run exercises those.
 */
export interface FakeContentOptions {
  /** Types Content Manager displays (the permissions grid). */
  types?: string[];
  docs?: Record<string, Array<Record<string, unknown>>>;
  deny?: Partial<Record<'read' | 'create' | 'update' | 'publish', string[]>>;
  hiddenFields?: string[];
  /** Types whose update/publish permission is "is creator": refused when the entity carries no createdBy. */
  creatorScoped?: string[];
  emailFails?: string;
  noEmailPlugin?: boolean;
}

export function fakeContentStrapi(options: FakeContentOptions = {}) {
  const { types = [], docs = {}, deny = {}, hiddenFields = [], creatorScoped = [] } = options;
  const hidden = new Set(hiddenFields);
  const calls: Array<{ op: string; uid?: string; params: unknown }> = [];
  const omitHidden = (record: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !hidden.has(key)));
  const denied = (action: keyof NonNullable<FakeContentOptions['deny']>, uid: string) =>
    (deny[action] ?? []).includes(uid);
  const sanitize = async (record: Record<string, unknown>) => omitHidden(record);
  const displayedTypes = () => types.map((uid) => ({ uid }));

  // "is creator": the condition needs createdBy on the entity it is handed. A
  // type-level check (no entity) passes, as in Strapi.
  const lacksCreator = (uid: string, entity?: Record<string, unknown>) =>
    creatorScoped.includes(uid) && entity !== undefined && !entity.createdBy;

  const checker = (uid: string) => ({
    cannot: {
      read: (entity?: Record<string, unknown>) => denied('read', uid) || Boolean(entity?.ownedByOther),
      create: () => denied('create', uid),
      update: (entity?: Record<string, unknown>) =>
        denied('update', uid) || Boolean(entity?.ownedByOther) || lacksCreator(uid, entity),
      publish: (entity?: Record<string, unknown>) =>
        denied('publish', uid) || Boolean(entity?.ownedByOther) || lacksCreator(uid, entity),
    },
    sanitizeQuery: async (query: Record<string, unknown>) => query,
    sanitizedQuery: {
      read: async (query: Record<string, unknown>) => ({ ...query, permissionCondition: true }),
      update: async (query: Record<string, unknown>) => ({ ...query, permissionCondition: true }),
    },
    sanitizeOutput: sanitize,
    sanitizeCreateInput: sanitize,
    sanitizeUpdateInput: () => sanitize,
  });

  const findById = (uid: string, id: unknown) => (docs[uid] ?? []).find((doc) => doc.documentId === id);

  // content-manager's populate-builder: records the query, builds a populate
  // that loads createdBy (what the permission conditions read).
  const populateBuilderFor = (uid: string) => {
    const builder = {
      populateFromQuery: (query: unknown) => {
        calls.push({ op: 'populateFromQuery', uid, params: query });
        return builder;
      },
      build: async () => ({ createdBy: true }),
    };
    return builder;
  };

  const strapi = {
    contentTypes: Object.fromEntries(types.map((uid) => [uid, { uid, attributes: {} }])),
    documents: (uid: string) => ({
      findFirst: async (params: Record<string, unknown>) => {
        calls.push({ op: 'findFirst', uid, params });
        const id = (params.filters as { documentId?: { $eq?: unknown } } | undefined)?.documentId?.$eq;
        const doc = findById(uid, id);
        // The permission condition, as the real query would apply it.
        if (doc && params.permissionCondition && doc.ownedByOther) return null;
        return doc ?? null;
      },
      findOne: async (params: Record<string, unknown>) => {
        calls.push({ op: 'findOne', uid, params });
        const doc = findById(uid, params.documentId);
        if (!doc) return null;
        // Like the real thing: createdBy only comes back when it was populated.
        const populate = params.populate as Record<string, unknown> | undefined;
        if (!populate?.createdBy) {
          return Object.fromEntries(Object.entries(doc).filter(([key]) => key !== 'createdBy'));
        }
        return doc;
      },
      create: async (params: Record<string, unknown>) => {
        calls.push({ op: 'create', uid, params });
        return { documentId: 'new-doc', ...(params.data as Record<string, unknown>) };
      },
      update: async (params: Record<string, unknown>) => {
        calls.push({ op: 'update', uid, params });
        return { ...findById(uid, params.documentId), ...(params.data as Record<string, unknown>) };
      },
    }),
    plugin: (name: string) => {
      if (name === 'email' && options.noEmailPlugin) return;
      return {
        service: (service: string) => {
          if (name === 'content-manager' && service === 'content-types') {
            return { findDisplayedContentTypes: displayedTypes };
          }
          if (name === 'content-manager' && service === 'populate-builder') {
            return populateBuilderFor;
          }
          if (name === 'content-manager' && service === 'permission-checker') {
            return { create: ({ model }: { model: string }) => checker(model) };
          }
          if (name === 'upload' && service === 'upload') {
            return {
              upload: async (params: unknown) => {
                calls.push({ op: 'upload', params });
                return [{ id: 42, name: 'cat.png', url: '/uploads/cat.png', mime: 'image/png', size: 3 }];
              },
            };
          }
          if (name === 'email' && service === 'email') {
            return {
              send: async (params: unknown) => {
                calls.push({ op: 'email', params });
                if (options.emailFails) throw new Error(options.emailFails);
              },
            };
          }
          throw new Error(`unexpected service ${name}.${service}`);
        },
      };
    },
    log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;

  return { strapi, calls };
}

/** An admin with an ability; the fake checker decides, not the ability. */
export const CALLER = { userAbility: { can: () => true }, user: { id: 7 } };

type AnyTool = { createHandler: (strapi: Core.Strapi, context: never) => (input: never) => Promise<unknown> };

export const runTool = (tool: AnyTool, strapi: Core.Strapi, args: Record<string, unknown>, context: unknown = CALLER) =>
  tool.createHandler(strapi, context as never)({ args, extra: {} } as never);

export const structured = (result: unknown) =>
  (result as { structuredContent?: Record<string, unknown> }).structuredContent;

export const errorText = (result: unknown) =>
  (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '';
