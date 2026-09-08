import { describe, expect, it } from 'vitest';
import { autoLinkContentTypeUids, splitProtected } from './auto-link';

/**
 * The UID auto-linker.
 *
 * It rewrites MODEL OUTPUT on every render of a streaming answer, so both its
 * correctness and its cost are worth pinning: the bug it was born from rendered
 * raw link syntax on screen, and the rewrite it replaced could backtrack.
 */

const link = (uid: string, label = uid) =>
  `[${label}](/content-manager/collection-types/${uid})`;

describe('autoLinkContentTypeUids', () => {
  it('links a bare uid in prose', () => {
    expect(autoLinkContentTypeUids('See api::product.product now.')).toBe(
      `See ${link('api::product.product')} now.`,
    );
  });

  it('links AROUND a code span rather than inside it', () => {
    // The original bug: rewriting inside backticks produces link syntax where
    // markdown is not parsed, so the reader sees the raw brackets.
    expect(autoLinkContentTypeUids('Products (`api::product.product`)')).toBe(
      `Products (${link('api::product.product', '`api::product.product`')})`,
    );
  });

  it('leaves a fenced block completely alone', () => {
    const fenced = '```\napi::product.product\n```';
    expect(autoLinkContentTypeUids(fenced)).toBe(fenced);
  });

  it('does not double-link something already a link', () => {
    const already = link('api::product.product');
    expect(autoLinkContentTypeUids(already)).toBe(already);
  });

  it('handles prose, code and a fence in one answer', () => {
    const input = 'Use api::a.a, or `api::b.b`.\n```\napi::c.c\n```\nDone.';
    const output = autoLinkContentTypeUids(input);
    expect(output).toContain(link('api::a.a'));
    expect(output).toContain(link('api::b.b', '`api::b.b`'));
    expect(output).toContain('```\napi::c.c\n```');
  });

  it('leaves a code span that is not exactly a uid untouched', () => {
    expect(autoLinkContentTypeUids('`uid: api::product.product`')).toBe(
      '`uid: api::product.product`',
    );
  });

  it('leaves text with no uid unchanged', () => {
    expect(autoLinkContentTypeUids('nothing to see')).toBe('nothing to see');
  });
});

describe('splitProtected', () => {
  it('does not swallow the answer after an UNTERMINATED fence', () => {
    /*
     * Mid-stream the closing fence has not arrived yet. What matters is not
     * that nothing is protected — a stray pair of backticks is an empty code
     * span, and protecting two characters costs nothing — but that the REST of
     * the answer stays live. Swallowing it would make links flicker in and out
     * as the text lands.
     */
    const output = autoLinkContentTypeUids('before ```\napi::a.a');
    expect(output).toContain(link('api::a.a'));
  });

  it('does not treat a backtick across a newline as inline code', () => {
    const segments = splitProtected('a ` b\nc ` d');
    expect(segments.every((segment) => !segment.isProtected)).toBe(true);
  });

  it('reassembles to exactly the input', () => {
    // Every branch slices; a mistake in any offset silently drops or repeats
    // text, which is far worse than a missed link.
    for (const input of [
      'plain',
      '`code`',
      '```\nfence\n```',
      '[a](b)',
      'mixed `x` and ```\ny\n``` and [z](w) end',
      '``',
      '[unclosed',
    ]) {
      expect(splitProtected(input).map((s) => s.text).join('')).toBe(input);
    }
  });

  it('stays fast on input that made the old regex backtrack', () => {
    // Many backticks, no closing fence — what a half-written answer looks like.
    // The lazy `[\s\S]*?` form this replaced degraded super-linearly here.
    const pathological = '```' + '`x'.repeat(20_000);
    const started = performance.now();
    autoLinkContentTypeUids(pathological);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
