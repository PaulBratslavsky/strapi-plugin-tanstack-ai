import type { Core } from '@strapi/strapi';
import type { PluginConfig } from '../config';

/**
 * What the conversation costs before the user has typed anything.
 *
 * Ported from the reference plugin's `lib/context-budget.ts`, which exists for
 * a failure its header describes: the plugin sends a system prompt and every
 * tool's schema ahead of the question, and when that preamble is a large share
 * of the model's window the model does not error — it hangs, or answers while
 * ignoring its tools. The obvious conclusion is that tool calling is broken.
 * Showing the number turns an afternoon of guessing into a glance.
 */

/**
 * Rough, and deliberately so.
 *
 * A real tokeniser differs per model and would have to be shipped per
 * provider. Four characters per token is the usual approximation for English
 * prose and JSON schemas, and everything built on it is labelled an estimate.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type ContextWindowSource = 'config' | 'ollama' | 'known-model' | 'unknown';

export interface DetectedWindow {
  window: number | null;
  source: ContextWindowSource;
  /** What the weights support, when it differs from what is being served. */
  trained: number | null;
}

/**
 * Published context windows, for providers that will not tell us.
 *
 * Anthropic has no endpoint to ask, so this is a lookup — wrong only if a
 * model ships with a different window, which is why `source` is reported
 * alongside and the badge says where the number came from.
 */
const KNOWN_WINDOWS: Array<[RegExp, number]> = [
  [/^claude-(sonnet|opus|haiku)-[45]/, 200_000],
  [/^claude-3/, 200_000],
];

/**
 * Ask Ollama what it is actually serving.
 *
 * `fetchImpl` is a parameter so a test can answer without a running Ollama —
 * the same reason the reference plugin threads one through. Detection has real
 * branches (served vs trained, malformed URL, timeout, an older Ollama that
 * reports neither) and none of them are reachable otherwise.
 */
async function askOllama(
  baseURL: string,
  model: string,
  fetchImpl: typeof fetch,
): Promise<DetectedWindow | null> {
  let origin: string;
  try {
    origin = new URL(baseURL).origin;
  } catch {
    return null;
  }

  const controller = new AbortController();
  // Short: this runs while someone waits for a badge to appear.
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchImpl(`${origin}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      model_info?: Record<string, unknown>;
      parameters?: string;
    };

    // What the weights were trained for, e.g. `qwen3.context_length`.
    const trainedEntry = Object.entries(body.model_info ?? {}).find(([key]) =>
      key.endsWith('context_length'),
    );
    const trained = typeof trainedEntry?.[1] === 'number' ? trainedEntry[1] : null;

    /*
     * What is actually SERVED, which is the number that matters and is
     * usually smaller. Ollama defaults to a fraction of the trained window
     * unless a Modelfile raises it, and reports that as a `num_ctx` line in
     * the parameters blob.
     */
    const numCtx = /num_ctx\s+(\d+)/.exec(body.parameters ?? '');
    const served = numCtx ? Number(numCtx[1]) : null;

    if (served) return { window: served, source: 'ollama', trained };
    if (trained) return { window: trained, source: 'ollama', trained };
    return null;
  } catch {
    // Unreachable, slow, or an older Ollama. Not knowing is a valid answer.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function detectContextWindow(
  config: PluginConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<DetectedWindow> {
  const configured = config.chat.contextWindow;
  if (typeof configured === 'number' && configured > 0) {
    return { window: configured, source: 'config', trained: null };
  }

  if (config.chat.provider === 'ollama' && config.chat.baseURL) {
    const detected = await askOllama(config.chat.baseURL, config.chat.model, fetchImpl);
    if (detected) return detected;
  }

  const known = KNOWN_WINDOWS.find(([pattern]) => pattern.test(config.chat.model));
  if (known) return { window: known[1], source: 'known-model', trained: null };

  return { window: null, source: 'unknown', trained: null };
}

/** When the preamble is a big enough share of the window to explain bad answers. */
export function warnAboutBudget(preambleTokens: number, window: number | null): string | null {
  if (!window) return null;
  const share = preambleTokens / window;

  if (share >= 0.5) {
    return (
      `Instructions and tool schemas take about ${Math.round(share * 100)}% of this model's ` +
      `${window}-token window before your message. Expect it to lose the thread quickly, or ` +
      'ignore its tools. Raise the window, or grant fewer tools.'
    );
  }
  if (share >= 0.25) {
    return (
      `Instructions and tool schemas take about ${Math.round(share * 100)}% of the window. ` +
      'Long conversations will start dropping their earliest turns.'
    );
  }
  return null;
}

/** Measure a built tool set the way it will be sent. */
export function measureTools(tools: unknown[]): { tokens: number; count: number } {
  let tokens = 0;
  for (const tool of tools) {
    try {
      tokens += estimateTokens(JSON.stringify(tool) ?? '');
    } catch {
      // A tool carrying something unserialisable still costs something.
      tokens += 50;
    }
  }
  return { tokens, count: tools.length };
}

/** Never let a badge's measurement break a boot or a request. */
export function safeDetect(strapi: Core.Strapi, config: PluginConfig): Promise<DetectedWindow> {
  return detectContextWindow(config).catch((error) => {
    strapi.log.debug(
      '[tanstack-ai] could not detect the context window: ' +
        (error instanceof Error ? error.message : String(error)),
    );
    return { window: null, source: 'unknown' as const, trained: null };
  });
}
