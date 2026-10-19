import { describe, expect, it } from 'vitest';
import { updateContent } from './update-content';
import { errorText, fakeContentStrapi, runTool, structured } from './test-support';

const ARTICLE = 'api::article.article';
const docs = { [ARTICLE]: [{ documentId: 'mine', title: 'Old' }, { documentId: 'theirs', title: 'T', ownedByOther: true }] };

describe('update_content', () => {
  it('updates through the update sanitiser and stamps updatedBy only', async () => {
    const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE], docs, hiddenFields: ['secret'] });
    const result = await runTool(updateContent, strapi, { contentType: ARTICLE, documentId: 'mine', data: { title: 'New', secret: 'x' } });
    const update = calls.find((call) => call.op === 'update');
    expect((update?.params as { data: unknown }).data).toEqual({ title: 'New', updatedBy: 7 });
    expect(structured(result)).toMatchObject({ documentId: 'mine', data: { title: 'New' } });
  });

  it('returns the updated row through the output sanitiser', async () => {
    // The fake update returns { ...storedDoc, ...data }, so a field that exists
    // only on the STORED doc reaches the result independently of the input.
    // Only the output sanitiser can drop it.
    const stored = { [ARTICLE]: [{ documentId: 'mine', title: 'Old', secret: 'leaked' }] };
    const { strapi } = fakeContentStrapi({ types: [ARTICLE], docs: stored, hiddenFields: ['secret'] });
    const result = await runTool(updateContent, strapi, { contentType: ARTICLE, documentId: 'mine', data: { title: 'New' } });
    expect(structured(result)?.data).toEqual({ documentId: 'mine', title: 'New', updatedBy: 7 });
    expect(structured(result)?.data).not.toHaveProperty('secret');
  });

  it('loads the draft with the permission populate, so an "is creator" caller can update their own document', async () => {
    // Strapi's is-creator condition reads createdBy; the draft must be loaded with it populated.
    const mine = { [ARTICLE]: [{ documentId: 'mine', title: 'Old', createdBy: { id: 7 } }] };
    const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE], docs: mine, creatorScoped: [ARTICLE] });
    const result = await runTool(updateContent, strapi, { contentType: ARTICLE, documentId: 'mine', data: { title: 'New' } });
    expect(result).not.toHaveProperty('isError');
    expect(calls.some((call) => call.op === 'update')).toBe(true);
    const findOne = calls.find((call) => call.op === 'findOne');
    expect(findOne?.params).toMatchObject({ documentId: 'mine', status: 'draft', populate: { createdBy: true } });
  });

  it('answers an entry hidden by a condition exactly like a missing one, and writes nothing', async () => {
    // Review Focus 2.
    const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE], docs });
    const hiddenOne = await runTool(updateContent, strapi, { contentType: ARTICLE, documentId: 'theirs', data: { title: 'x' } });
    const missing = await runTool(updateContent, strapi, { contentType: ARTICLE, documentId: 'nope', data: { title: 'x' } });
    expect(errorText(hiddenOne).replace('theirs', 'ID')).toBe(errorText(missing).replace('nope', 'ID'));
    expect(calls.some((call) => call.op === 'update')).toBe(false);
  });

  it('refuses a type the caller cannot update', async () => {
    const { strapi } = fakeContentStrapi({ types: [ARTICLE], docs, deny: { update: [ARTICLE] } });
    const result = await runTool(updateContent, strapi, { contentType: ARTICLE, documentId: 'mine', data: { title: 'x' } });
    expect(result).toMatchObject({ isError: true });
  });

  it('refuses status "published" without Publish permission, before writing', async () => {
    // Review Focus 3.
    const { strapi, calls } = fakeContentStrapi({ types: [ARTICLE], docs, deny: { publish: [ARTICLE] } });
    const result = await runTool(updateContent, strapi, { contentType: ARTICLE, documentId: 'mine', data: { title: 'x' }, status: 'published' });
    expect(result).toMatchObject({ isError: true });
    expect(calls.some((call) => call.op === 'update')).toBe(false);
  });
});
