import { describe, expect, it } from 'vitest';
import config from '../config';
import { chatStatus } from './chat-status';

const chat = (over: Record<string, unknown>) => ({ ...config.default.chat, ...over }) as never;

describe('chatStatus', () => {
  it('is ready when on and the provider has its credential', () => {
    expect(chatStatus(chat({ provider: 'anthropic', apiKey: 'k' }))).toEqual({ enabled: true, ready: true });
    expect(chatStatus(chat({ provider: 'ollama', baseURL: 'http://localhost:11434' }))).toEqual({
      enabled: true,
      ready: true,
    });
  });

  it('names the missing setting instead of failing', () => {
    const anthropic = chatStatus(chat({ provider: 'anthropic', apiKey: undefined }));
    expect(anthropic.ready).toBe(false);
    expect(anthropic.reason).toMatch(/apiKey/);

    const ollama = chatStatus(chat({ provider: 'ollama', baseURL: undefined }));
    expect(ollama.ready).toBe(false);
    expect(ollama.reason).toMatch(/baseURL/);
  });

  it('reports a chat turned off as not ready', () => {
    const off = chatStatus(chat({ enabled: false, apiKey: 'k' }));
    expect(off).toMatchObject({ enabled: false, ready: false });
    expect(off.reason).toMatch(/chat\.enabled/);
  });
});

describe('config defaults and validator', () => {
  it('turns chat on by default', () => {
    expect(config.default.chat.enabled).toBe(true);
  });

  it('boots with chat on and no credential', () => {
    expect(() => config.validator({ chat: chat({ provider: 'anthropic', apiKey: undefined }) })).not.toThrow();
  });

  it('still rejects an unknown provider', () => {
    expect(() => config.validator({ chat: chat({ provider: 'openai' }) })).toThrow(/provider/);
  });
});
