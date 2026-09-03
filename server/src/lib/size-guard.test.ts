import { describe, expect, it } from 'vitest';
import { oversizeNotice, wireBytes } from './size-guard';

describe('wireBytes', () => {
  it('counts the payload twice, because it is sent twice', () => {
    // The whole point of the module. A single-copy measurement would pass
    // results that then fail at the client with an opaque error.
    const payload = { text: 'x'.repeat(1000) };
    const once = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    expect(wireBytes(payload)).toBeGreaterThan(once * 2);
  });

  it('measures bytes rather than characters', () => {
    // A multi-byte character is one `.length` and several bytes; the wire
    // carries bytes.
    expect(wireBytes({ a: '€'.repeat(100) })).toBeGreaterThan(
      wireBytes({ a: 'e'.repeat(100) }),
    );
  });

  it('reports nothing for an unserialisable payload', () => {
    expect(wireBytes(undefined)).toBe(0);
  });
});

describe('oversizeNotice', () => {
  it('passes a result that fits', () => {
    expect(oversizeNotice({ results: [] }, 'search_content', 950_000)).toBeNull();
  });

  it('refuses a result that only fits when counted once', () => {
    // 300 KB serialised is 600 KB on the wire. A guard comparing one copy
    // against a 500 KB budget would wave this through.
    const payload = { blob: 'x'.repeat(300_000) };
    expect(oversizeNotice(payload, 'search_content', 500_000)).not.toBeNull();
  });

  it('returns the error branch, never a stand-in payload', () => {
    // A smaller substitute object would either violate the tool's declared
    // output schema or, worse, validate as a legitimate empty result and read
    // to the model as "nothing found".
    const notice = oversizeNotice({ blob: 'x'.repeat(600_000) }, 'search_content', 950_000);
    expect(notice).toMatchObject({ isError: true });
    expect(notice).not.toHaveProperty('structuredContent');
  });

  it('tells the model how to make the call smaller', () => {
    // An oversized result the agent cannot act on is a dead end; the hint is
    // what makes the retry differ from the first attempt.
    const notice = oversizeNotice({ blob: 'x'.repeat(600_000) }, 'search_content', 950_000);
    expect(notice?.content[0].text).toMatch(/pageSize/);
  });
});
