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

/** Test seam: forget the cached module so a test can observe a fresh load. */
export function resetAIForTests(): void {
  cached = null;
}
