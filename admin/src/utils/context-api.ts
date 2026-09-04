import { PLUGIN_ID } from '../pluginId';
import { authHeaders, backendURL } from './auth';

/** What the preamble costs, and which model answers. Both are informational. */

export interface ContextInfo {
  systemTokens: number;
  toolTokens: number;
  toolCount: number;
  /** Instructions plus tool schemas, sent before the conversation. */
  preambleTokens: number;
  contextWindow: number | null;
  windowSource: 'config' | 'ollama' | 'known-model' | 'unknown';
  trainedContext: number | null;
  warning: string | null;
  estimated: true;
}

export interface ModelInfo {
  provider: string;
  model: string;
  baseURL: string | null;
  /** True only when the baseURL is a loopback or private host. */
  isLocal: boolean;
}

/**
 * Both return null rather than throwing.
 *
 * These feed a badge. A chat that refuses to load because a gauge could not be
 * measured would be a worse plugin than one that quietly shows no gauge.
 */
async function get<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${backendURL()}/${PLUGIN_ID}/${path}`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!response.ok) return null;
    const json = await response.json();
    return (json.data as T) ?? null;
  } catch {
    return null;
  }
}

export const fetchContextInfo = () => get<ContextInfo>('context-info');
export const fetchModelInfo = () => get<ModelInfo>('model-info');
