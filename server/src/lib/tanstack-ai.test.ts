import { describe, expect, it } from 'vitest';
import { loadAdapter } from './tanstack-ai';

/**
 * The adapters the chat builds, checked against the real provider packages.
 *
 * Both factories are generic over a model literal, so the call sites need a
 * cast, and a cast is exactly what let 1.0.0 pass `{ apiKey, model }` where
 * `createAnthropicChat` takes `(model, apiKey)`. It type-checked, it booted,
 * and every Anthropic request named a model that does not exist. Only building
 * the adapter and reading it back catches that.
 */
describe('loadAdapter', () => {
  it('builds an Anthropic adapter for the configured model', async () => {
    const adapter = (await loadAdapter({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      apiKey: 'sk-test-not-real',
    })) as { model: unknown };

    expect(adapter.model).toBe('claude-sonnet-5');
  });

  it('builds an Ollama adapter for the configured model', async () => {
    const adapter = (await loadAdapter({
      provider: 'ollama',
      model: 'qwen3:14b',
      baseURL: 'http://localhost:11434',
    })) as { model: unknown };

    expect(adapter.model).toBe('qwen3:14b');
  });
});
