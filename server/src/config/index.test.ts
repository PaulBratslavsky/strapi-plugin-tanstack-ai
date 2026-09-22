import { describe, expect, it } from 'vitest';
import config from './index';

/**
 * The config contract, which is also the plugin's packaging promise: install
 * it for the MCP tools alone and no AI SDK is required. Every assertion here
 * is one half of that promise.
 */

const { default: defaults, validator } = config;

describe('defaults', () => {
  it('has chat ON', () => {
    // Safe since 1.3.0: a missing key or optional peer makes chat "not ready"
    // (lib/chat-status.ts) instead of failing the boot, so a tools-only host
    // still starts.
    expect(defaults.chat.enabled).toBe(true);
  });

  it('registers MCP tools unconditionally — there is no mcp.enabled to turn off', () => {
    // The two halves are gated differently on purpose: tools always, chat
    // opt-in. A tools-only install must not have to configure anything.
    expect(defaults.mcp).not.toHaveProperty('enabled');
  });

  it('leaves the tool prefix empty', () => {
    // Neither tool collides with a built-in, and the tool descriptions name
    // them unprefixed.
    expect(defaults.mcp.toolPrefix).toBe('');
  });

  it('budgets close to the MCP client limit, not a round guess', () => {
    // Counted doubled, so this is ~475 KB of actual result. A tighter default
    // would refuse legitimate cross-type answers.
    expect(defaults.mcp.sizeLimitBytes).toBe(950_000);
  });
});

describe('validator', () => {
  it('accepts the defaults', () => {
    expect(() => validator(defaults)).not.toThrow();
  });

  it('says nothing about credentials while chat is off', () => {
    // A tools-only host has no API key and should never be asked for one.
    expect(() => validator({ chat: { enabled: false, provider: 'anthropic', model: 'x' } })).not.toThrow();
  });

  it('boots anthropic chat with no API key, leaving it not ready', () => {
    // Chat is on by default, so throwing here would stop every host without a
    // key from booting. The gap is reported by chatStatus instead.
    expect(() =>
      validator({ chat: { enabled: true, provider: 'anthropic', model: 'claude-sonnet-5' } }),
    ).not.toThrow();
  });

  it('boots ollama chat with no baseURL, leaving it not ready', () => {
    expect(() =>
      validator({ chat: { enabled: true, provider: 'ollama', model: 'qwen3:14b' } }),
    ).not.toThrow();
  });

  it('rejects an unknown provider by name', () => {
    expect(() =>
      validator({ chat: { enabled: true, provider: 'openai' as never, model: 'gpt' } }),
    ).toThrow(/anthropic.*ollama/);
  });

  it('rejects a non-positive size limit', () => {
    // Zero would refuse every result, and the refusal names a limit of 0 —
    // a confusing way to discover a typo.
    expect(() => validator({ mcp: { toolPrefix: '', sizeLimitBytes: 0 } })).toThrow(/positive/);
  });
});
