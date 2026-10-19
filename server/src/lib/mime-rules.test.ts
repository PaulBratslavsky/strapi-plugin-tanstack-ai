import { describe, expect, it } from 'vitest';
import { mimeRefusal, normalizeMime } from './mime-rules';

describe('normalizeMime', () => {
  it('strips parameters and lowercases', () => {
    expect(normalizeMime('Image/PNG; charset=binary')).toBe('image/png');
  });
  it('defaults to octet-stream', () => {
    expect(normalizeMime(null)).toBe('application/octet-stream');
    expect(normalizeMime('')).toBe('application/octet-stream');
  });
});

describe('mimeRefusal', () => {
  it('allows anything when nothing is configured', () => {
    expect(mimeRefusal('image/png')).toBeUndefined();
  });
  it.each(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/javascript', 'text/javascript', 'application/x-sh'])(
    'always refuses %s, with no config at all',
    (type) => expect(mimeRefusal(type)).toMatch(/not accepted/),
  );
  it('refuses the built-in list even when allowedTypes names it', () => {
    expect(mimeRefusal('text/html', { allowedTypes: ['text/*'] })).toMatch(/not accepted/);
  });
  it('strips parameters before matching', () => {
    expect(mimeRefusal('Text/HTML; charset=utf-8')).toMatch(/not accepted/);
    expect(mimeRefusal('image/png; foo=bar', { allowedTypes: ['image/png'] })).toBeUndefined();
  });
  it('honours a type/* wildcard in allowedTypes', () => {
    expect(mimeRefusal('image/webp', { allowedTypes: ['image/*'] })).toBeUndefined();
    expect(mimeRefusal('video/mp4', { allowedTypes: ['image/*'] })).toMatch(/not allowed/);
  });
  it('honours exact entries in allowedTypes', () => {
    expect(mimeRefusal('application/pdf', { allowedTypes: ['application/pdf'] })).toBeUndefined();
    expect(mimeRefusal('application/zip', { allowedTypes: ['application/pdf'] })).toMatch(/not allowed/);
  });
  it('treats an empty allowedTypes as no restriction', () => {
    expect(mimeRefusal('video/mp4', { allowedTypes: [] })).toBeUndefined();
  });
  it('refuses deniedTypes, wildcard or exact', () => {
    expect(mimeRefusal('audio/mpeg', { deniedTypes: ['audio/*'] })).toMatch(/blocked/);
    expect(mimeRefusal('application/zip', { deniedTypes: ['application/zip'] })).toMatch(/blocked/);
  });
  it('lets deny win over allow', () => {
    expect(mimeRefusal('image/gif', { allowedTypes: ['image/*'], deniedTypes: ['image/gif'] })).toMatch(/blocked/);
  });
});
