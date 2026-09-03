/**
 * The entire boundary between this CommonJS plugin and the ESM-only SDK.
 *
 * WHY A SEAM EXISTS AT ALL. Strapi plugins are CommonJS; `@tanstack/ai` ships
 * ESM only. A top-level `import` would make the SDK a hard load-time
 * dependency of the plugin — so a host that installed this for the MCP tools,
 * and never wanted chat, would still have to have the package present and
 * loadable. That is the opposite of the packaging promise: the SDK is an
 * OPTIONAL peer dependency (see package.json), which means it may genuinely be
 * absent.
 *
 * A dynamic `import()` from CJS is the supported bridge, and it costs nothing
 * ergonomically here because every consumer is already async.
 *
 * WHY ONE FILE. Confining it means the rest of the plugin never mentions the
 * SDK, so "does the tools-only path load @tanstack/ai?" is answerable by
 * reading imports rather than by tracing a module graph. If this file is not
 * called, the SDK is not loaded — which is a property you can check.
 */

/**
 * Type-only import. Erased at compile time, so it does NOT put the SDK in the
 * module graph — the built bundle is greppable proof. It buys real inference:
 * `chat()` returns a union unless its adapter type is known, and an untyped
 * adapter silently selects the non-streaming overload.
 */
import type { AnyTextAdapter } from '@tanstack/ai';

/** Cached so repeated chat turns do not re-resolve the module graph. */
let cached: typeof import('@tanstack/ai') | null = null;

/**
 * Load the SDK, or explain precisely why it is missing.
 *
 * Call ONLY behind `chat.enabled`. The error text names the fix because this
 * failure mode — optional peer not installed — is otherwise a bare
 * ERR_MODULE_NOT_FOUND that reads like a bug in the plugin.
 */
export async function loadAI(): Promise<typeof import('@tanstack/ai')> {
  if (cached) return cached;
  try {
    cached = await import('@tanstack/ai');
    return cached;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      '[tanstack-ai] chat is enabled but @tanstack/ai could not be loaded. ' +
        'It is an optional peer dependency, so install it in the host app: ' +
        `npm install @tanstack/ai. Original error: ${detail}`,
    );
  }
}

/**
 * The chat adapter for a provider, loaded the same lazy way.
 *
 * The adapters live in SEPARATE packages — `@tanstack/ai-anthropic`,
 * `@tanstack/ai-ollama` — so they are optional peers too, and the import has
 * to be behind the same gate. Importing both eagerly to pick one at runtime
 * would defeat the point: a host that only ever uses Ollama would still need
 * the Anthropic package installed.
 *
 * Only the selected provider's package is touched.
 */
export async function loadAdapter(config: {
  provider: 'anthropic' | 'ollama';
  model: string;
  apiKey?: string;
  baseURL?: string;
}): Promise<AnyTextAdapter> {
  if (config.provider === 'anthropic') {
    const mod = await importOrExplain('@tanstack/ai-anthropic');
    return mod.createAnthropicChat({
      apiKey: config.apiKey,
      model: config.model,
    } as never) as AnyTextAdapter;
  }

  const mod = await importOrExplain('@tanstack/ai-ollama');
  return mod.createOllamaChat(config.model as never, config.baseURL) as AnyTextAdapter;
}

/**
 * Dynamic import with an error that says what to do.
 *
 * A missing optional peer surfaces as a bare ERR_MODULE_NOT_FOUND naming a
 * package the operator never asked for, which reads as a bug in the plugin
 * rather than as a deliberate install-time choice.
 */
async function importOrExplain<T extends string>(specifier: T) {
  try {
    return (await import(specifier)) as never as {
      createAnthropicChat: (o: unknown) => unknown;
      createOllamaChat: (m: unknown, b?: string) => unknown;
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[tanstack-ai] chat is enabled but ${specifier} could not be loaded. ` +
        `It is an optional peer dependency, so install it in the host app: ` +
        `npm install ${specifier}. Original error: ${detail}`,
    );
  }
}

/** Test seam: forget the cached module so a test can observe a fresh load. */
export function resetAIForTests(): void {
  cached = null;
}
