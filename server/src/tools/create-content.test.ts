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
});
