import { describe, expect, it } from 'vitest';
import config from './index';

/**
 * The config contract, which is also the plugin's packaging promise: install
 * it for the MCP tools alone and no AI SDK is required. Every assertion here
 * is one half of that promise.
 */

const { default: defaults, validator } = config;

describe('defaults', () => {
  it('has chat OFF', () => {
    // The whole reason `@tanstack/ai` can be an optional peer. Defaulting this
    // to true would crash every host that took the packaging at its word.
    expect(defaults.chat.enabled).toBe(false);
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

  it('rejects anthropic chat with no API key, at boot', () => {
    // Boot, not first use: misconfiguration is a deployment problem, so it
    // belongs in the deployment's feedback loop rather than surfacing as an
    // opaque provider error to whoever sends the first message.
    expect(() =>
      validator({ chat: { enabled: true, provider: 'anthropic', model: 'claude-sonnet-5' } }),
    ).toThrow(/apiKey/);
  });

  it('rejects ollama chat with no baseURL', () => {
    expect(() => validator({ chat: { enabled: true, provider: 'ollama', model: 'qwen3:14b' } })).toThrow(
      /baseURL/,
    );
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
