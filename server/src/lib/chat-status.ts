/**
 * Whether the admin chat can actually run, and if not, what to change.
 *
 * Chat is ON by default (1.3.0). That default is only safe because a missing
 * piece no longer stops Strapi booting: a tools-only host may have no API key
 * and no provider adapter installed, and must still start. So
 * instead of throwing, the plugin works out whether chat is usable and says
 * why not — in the boot log, on the unauthenticated config endpoint, and on
 * the chat page itself.
 *
 * Two layers:
 *
 *   chatStatus(config)  — synchronous, from config alone: turned off, or a
 *                         provider missing its credential. Routes are
 *                         registered from this, because Strapi reads routes
 *                         at load time, before anything async can run.
 *   probeChat(config)   — asynchronous, run once in bootstrap: additionally
 *                         loads the SDK and the provider's adapter package,
 *                         so an uninstalled adapter is reported at boot
 *                         rather than as a failed first message.
 */
import type { ChatConfig } from '../config';
import { loadAdapter, loadAI } from './tanstack-ai';

export interface ChatStatus {
  /** What the config asked for. */
  enabled: boolean;
  /** Whether a chat turn can run. */
  ready: boolean;
  /** Why not, naming the setting or package to fix. Absent when ready. */
  reason?: string;
}

export function chatStatus(chat: ChatConfig): ChatStatus {
  if (!chat.enabled) {
    return { enabled: false, ready: false, reason: 'Chat is turned off (chat.enabled: false in the plugin config).' };
  }
  if (chat.provider === 'anthropic' && !chat.apiKey) {
    return {
      enabled: true,
      ready: false,
      reason: 'Chat uses Anthropic but has no API key. Set chat.apiKey in the plugin config, usually from ANTHROPIC_API_KEY.',
    };
  }
  if (chat.provider === 'ollama' && !chat.baseURL) {
    return {
      enabled: true,
      ready: false,
      reason: 'Chat uses Ollama but has no server URL. Set chat.baseURL in the plugin config, usually from OLLAMA_HOST.',
    };
  }
  return { enabled: true, ready: true };
}

export async function probeChat(chat: ChatConfig): Promise<ChatStatus> {
  const status = chatStatus(chat);
  if (!status.ready) return status;
  try {
    await loadAI();
    await loadAdapter(chat);
    return status;
  } catch (error) {
    // loadAI / loadAdapter already phrase this as "install <package>".
    const reason = error instanceof Error ? error.message.replace(/^\[tanstack-ai\] /, '') : String(error);
    return { enabled: true, ready: false, reason };
  }
}

/**
 * The status bootstrap measured, once per boot.
 *
 * Module state, deliberately: it is a fact about this process, written once
 * in bootstrap and read by every request after. Before bootstrap has run (or
 * in a test that never runs it) the config-only answer stands in.
 */
let measured: ChatStatus | null = null;

export function recordChatStatus(status: ChatStatus): void {
  // eslint-disable-next-line unicorn/no-top-level-assignment-in-function -- see `measured`
  measured = status;
}

export function currentChatStatus(chat: ChatConfig): ChatStatus {
  return measured ?? chatStatus(chat);
}

/** Test seam. */
export function resetChatStatusForTests(): void {
  // eslint-disable-next-line unicorn/no-top-level-assignment-in-function -- see `measured`
  measured = null;
}
