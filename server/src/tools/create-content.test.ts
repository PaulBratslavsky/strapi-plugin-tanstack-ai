import { describe, expect, it } from 'vitest';
import { createContent } from './create-content';
import { errorText, fakeContentStrapi, runTool, structured } from './test-support';

const ARTICLE = 'api::article.article';

describe('create_content', () => {
  it('creates through the create sanitiser and stamps the caller as creator', async () => {
    const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE], hiddenFields: ['secret'] });
    await runTool(createContent, strapi, { contentType: ARTICLE, data: { title: 'New', secret: 'x' } });
    const create = calls.find((call) => call.op === 'create');
    expect((create?.params as { data: unknown }).data).toEqual({ title: 'New', createdBy: 7, updatedBy: 7 });
  });

  it('returns the created row through the output sanitiser', async () => {
    // Review Focus 1: Create without Read must not echo hidden fields back.
    const { strapi } = fakeContentStrapi({ types: [ARTICLE], hiddenFields: ['secret'] });
    // The fake create echoes the already-sanitised input, so it could never leak
    // on its own. Make the stored row carry a field the caller may not read (a
    // server-side default, say): only the OUTPUT sanitiser can drop it.
    (strapi as unknown as { documents: unknown }).documents = () => ({
      create: async () => ({ documentId: 'new-doc', title: 'New', secret: 'leaked' }),
    });
    const result = await runTool(createContent, strapi, { contentType: ARTICLE, data: { title: 'New' } });
    expect(structured(result)?.data).toEqual({ documentId: 'new-doc', title: 'New' });
    expect(structured(result)?.data).not.toHaveProperty('secret');
    expect(structured(result)).toMatchObject({ contentType: ARTICLE, documentId: 'new-doc' });
  });

  it('refuses a type the caller cannot create in, and writes nothing', async () => {
    const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE, 'api::tag.tag'], deny: { create: [ARTICLE] } });
    const result = await runTool(createContent, strapi, { contentType: ARTICLE, data: { title: 'x' } });
    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toContain('api::tag.tag');
    expect(calls.some((call) => call.op === 'create')).toBe(false);
  });

  it('refuses status "published" without Publish permission, before writing', async () => {
    // Review Focus 3.
    const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE], deny: { publish: [ARTICLE] } });
    const result = await runTool(createContent, strapi, { contentType: ARTICLE, data: { title: 'x' }, status: 'published' });
    expect(result).toMatchObject({ isError: true });
    expect(calls.some((call) => call.op === 'create')).toBe(false);
  });

  it('skips creator fields when there is no caller id, rather than writing createdBy: 0', async () => {
    const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE] });
    await runTool(createContent, strapi, { contentType: ARTICLE, data: { title: 'x' } }, { userAbility: {}, user: { id: 0 } });
    const create = calls.find((call) => call.op === 'create');
    expect((create?.params as { data: Record<string, unknown> }).data).not.toHaveProperty('createdBy');
  });

  it('still creates when Create is granted but Read is denied, and sanitises the result', async () => {
    const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE], deny: { read: [ARTICLE] }, hiddenFields: ['secret'] });
    const result = await runTool(createContent, strapi, { contentType: ARTICLE, data: { title: 'New', secret: 'x' } });
    expect(result).not.toHaveProperty('isError');
    const create = calls.find((call) => call.op === 'create');
    expect((create?.params as { data: Record<string, unknown> }).data).not.toHaveProperty('secret');
    expect(structured(result)?.data).not.toHaveProperty('secret');
    expect(structured(result)).toMatchObject({ contentType: ARTICLE, documentId: 'new-doc' });
  });

  describe('status "published"', () => {
    it('saves a draft first (no status on the write), checks Publish on the saved draft, then publishes', async () => {
      const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE] });
      const result = await runTool(createContent, strapi, { contentType: ARTICLE, data: { title: 'x' }, status: 'published', locale: 'en' });
      expect(result).not.toHaveProperty('isError');
      const create = calls.find((call) => call.op === 'create');
      expect(create?.params).not.toHaveProperty('status');
      // The saved draft was loaded with the permission populate before publishing.
      const order = calls.map((call) => call.op);
      expect(order.indexOf('create')).toBeLessThan(order.indexOf('findOne'));
      expect(order.indexOf('findOne')).toBeLessThan(order.indexOf('publish'));
      expect(calls.find((call) => call.op === 'findOne')?.params).toMatchObject({
        documentId: 'new-doc',
        status: 'draft',
        locale: 'en',
        populate: { createdBy: true },
      });
      expect(calls.find((call) => call.op === 'publish')?.params).toEqual({ documentId: 'new-doc', locale: 'en' });
      expect(structured(result)).toMatchObject({ documentId: 'new-doc', data: { title: 'x', publishedAt: 'now' } });
    });

    it('keeps the draft and says so when the entity-level Publish check refuses, without publishing', async () => {
      // Type-level Publish passes, but a condition on the saved document refuses it.
      const seeded = { [ARTICLE]: [{ documentId: 'new-doc', title: 'x', ownedByOther: true }] };
      const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE], docs: seeded });
      const result = await runTool(createContent, strapi, { contentType: ARTICLE, data: { title: 'x' }, status: 'published' });
      expect(result).toMatchObject({ isError: true });
      expect(errorText(result)).toContain('WAS saved');
      expect(errorText(result)).toContain('new-doc');
      expect(calls.some((call) => call.op === 'create')).toBe(true);
      expect(calls.some((call) => call.op === 'publish')).toBe(false);
    });

    it('on a type without draft and publish, ignores status and does not consult Publish', async () => {
      const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE], noDraftAndPublish: [ARTICLE], deny: { publish: [ARTICLE] } });
      const result = await runTool(createContent, strapi, { contentType: ARTICLE, data: { title: 'x' }, status: 'published' });
      expect(result).not.toHaveProperty('isError');
      expect(calls.find((call) => call.op === 'create')?.params).not.toHaveProperty('status');
      expect(calls.some((call) => call.op === 'publish')).toBe(false);
      expect(structured(result)).toMatchObject({ documentId: 'new-doc' });
    });
  });
});
