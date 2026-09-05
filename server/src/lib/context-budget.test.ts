import { describe, expect, it, vi } from 'vitest';
import type { PluginConfig } from '../config';
import {
  detectContextWindow,
  estimateTokens,
  measureTools,
  warnAboutBudget,
} from './context-budget';

/**
 * The context gauge.
 *
 * Worth testing rather than eyeballing because every number it shows is
 * arithmetic on someone else's data, and being wrong here is worse than being
 * absent: a badge saying 11K/41K is read as fact.
 */

const config = (chat: Partial<PluginConfig['chat']>): PluginConfig =>
  ({
    mcp: { toolPrefix: '', sizeLimitBytes: 950_000 },
    chat: { enabled: true, provider: 'ollama', model: 'qwen3:14b', ...chat },
  }) as PluginConfig;

/** An Ollama that answers `/api/show` with whatever the test wants. */
const fakeOllama = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe('estimateTokens', () => {
  it('counts four characters to the token', () => {
    expect(estimateTokens('12345678')).toBe(2);
  });

  it('rounds up, so a fragment is never free', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('is zero for nothing', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('measureTools', () => {
  it('counts the serialised size of each tool and how many there are', () => {
    const result = measureTools([{ name: 'a' }, { name: 'b' }]);
    expect(result.count).toBe(2);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it('still charges for a tool that cannot be serialised', () => {
    // A circular or exotic tool costs the model context whether or not this
    // module can measure it; reporting zero would understate the preamble.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(measureTools([circular]).tokens).toBeGreaterThan(0);
  });

  it('is zero for no tools', () => {
    expect(measureTools([])).toEqual({ tokens: 0, count: 0 });
  });
});

describe('detectContextWindow', () => {
  it('prefers what the operator configured', async () => {
    const fetchImpl = fakeOllama({});
    const result = await detectContextWindow(config({ contextWindow: 8000 }), fetchImpl);
    expect(result).toEqual({ window: 8000, source: 'config', trained: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports what Ollama is SERVING, not what the weights support', async () => {
    // The distinction the badge exists for. Ollama defaults to a fraction of
    // the trained window, and the smaller number is the one that explains a
    // model losing the thread.
    const result = await detectContextWindow(
      config({ baseURL: 'http://localhost:11434' }),
      fakeOllama({
        model_info: { 'qwen3.context_length': 131_072 },
        parameters: 'num_ctx    41000\nstop "<|im_end|>"',
      }),
    );
    expect(result.window).toBe(41_000);
    expect(result.trained).toBe(131_072);
    expect(result.source).toBe('ollama');
  });

  it('falls back to the trained length when no num_ctx is reported', async () => {
    const result = await detectContextWindow(
      config({ baseURL: 'http://localhost:11434' }),
      fakeOllama({ model_info: { 'qwen3.context_length': 32_768 } }),
    );
    expect(result.window).toBe(32_768);
  });

  it('knows nothing rather than guessing when Ollama reports neither', async () => {
    const result = await detectContextWindow(
      config({ baseURL: 'http://localhost:11434' }),
      fakeOllama({ model_info: {} }),
    );
    expect(result).toEqual({ window: null, source: 'unknown', trained: null });
  });

  it('survives an unreachable Ollama', async () => {
    // Not knowing is a valid answer; a chat panel must not fail to render
    // because a gauge could not be measured.
    const failing = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await detectContextWindow(config({ baseURL: 'http://localhost:11434' }), failing);
    expect(result.window).toBeNull();
  });

  it('survives a non-200 from Ollama', async () => {
    const result = await detectContextWindow(
      config({ baseURL: 'http://localhost:11434' }),
      fakeOllama({}, false),
    );
    expect(result.window).toBeNull();
  });

  it('survives a malformed baseURL without calling out', async () => {
    const fetchImpl = fakeOllama({});
    const result = await detectContextWindow(config({ baseURL: 'not a url' }), fetchImpl);
    expect(result.window).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the published window for an Anthropic model, and asks nobody', async () => {
    const fetchImpl = fakeOllama({});
    const result = await detectContextWindow(
      config({ provider: 'anthropic', model: 'claude-sonnet-5', baseURL: undefined }),
      fetchImpl,
    );
    expect(result).toEqual({ window: 200_000, source: 'known-model', trained: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('admits it does not know an unrecognised model', async () => {
    const result = await detectContextWindow(
      config({ provider: 'anthropic', model: 'some-new-model', baseURL: undefined }),
      fakeOllama({}),
    );
    expect(result.source).toBe('unknown');
  });
});

describe('warnAboutBudget', () => {
  it('says nothing when the preamble is a small share', () => {
    expect(warnAboutBudget(2000, 100_000)).toBeNull();
  });

  it('warns about dropped turns past a quarter of the window', () => {
    expect(warnAboutBudget(30_000, 100_000)).toMatch(/earliest turns/i);
  });

  it('warns harder past half, where the model starts ignoring its tools', () => {
    // The failure this whole module exists for: no error, just a model that
    // answers without using what it was given.
    expect(warnAboutBudget(60_000, 100_000)).toMatch(/ignore its tools/i);
  });

  it('says nothing when the window is unknown', () => {
    // A share of an unknown total is not a fact worth alarming anyone with.
    expect(warnAboutBudget(60_000, null)).toBeNull();
  });
});
