import { describe, expect, it } from 'vitest';
import { findOneContent } from './find-one-content';
import { CALLER, errorText, fakeContentStrapi, runTool, structured } from './test-support';

const ARTICLE = 'api::article.article';

describe('find_one_content', () => {
  it('returns one document, run through the permission query and output sanitiser', async () => {
    const { strapi, calls } = fakeContentStrapi({
      types: [ARTICLE],
      docs: { [ARTICLE]: [{ documentId: 'a1', title: 'Hi', secret: 's' }] },
      hiddenFields: ['secret'],
    });
    const result = await runTool(findOneContent, strapi, { contentType: ARTICLE, documentId: 'a1' });
    expect(structured(result)).toEqual({ contentType: ARTICLE, documentId: 'a1', data: { documentId: 'a1', title: 'Hi' } });
    expect(calls[0].params).toMatchObject({ permissionCondition: true, populate: '*' });
  });

  it('answers an entry hidden by a permission condition exactly like a missing one', async () => {
    // Review Focus 2: different text would confirm the entry exists.
    const { strapi } = fakeContentStrapi({
      types: [ARTICLE],
      docs: { [ARTICLE]: [{ documentId: 'theirs', title: 'x', ownedByOther: true }] },
    });
    const hiddenOne = await runTool(findOneContent, strapi, { contentType: ARTICLE, documentId: 'theirs' });
    const missing = await runTool(findOneContent, strapi, { contentType: ARTICLE, documentId: 'nope' });
    expect(hiddenOne).toMatchObject({ isError: true });
    expect(errorText(hiddenOne).replace('theirs', 'ID')).toBe(errorText(missing).replace('nope', 'ID'));
  });

  it('refuses a type the caller cannot read, listing what they can', async () => {
    const { strapi } = fakeContentStrapi({ types: [ARTICLE, 'api::tag.tag'], deny: { read: [ARTICLE] } });
    const result = await runTool(findOneContent, strapi, { contentType: ARTICLE, documentId: 'a1' });
    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toContain('api::tag.tag');
  });

  it('fails closed without a caller ability', async () => {
    const { strapi } = fakeContentStrapi({ types: [ARTICLE] });
    const result = await runTool(findOneContent, strapi, { contentType: ARTICLE, documentId: 'a1' }, { user: CALLER.user });
    expect(result).toMatchObject({ isError: true });
  });
});
