import { PLUGIN_ID } from '../pluginId';
import { authHeaders, backendURL } from './auth';

/**
 * The conversations endpoint, as the panel talks to it.
 *
 * Ported from the reference plugin's `utils/conversations-api.ts`. Kept as a
 * thin module of plain functions rather than a hook: the hook owns state, this
 * owns the wire format, and a request that fails throws so the caller decides
 * what a failure means.
 */

const BASE = () => `${backendURL()}/${PLUGIN_ID}/conversations`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    // Resolved per request rather than captured once, so a token refreshed
    // mid-session does not leave this module authenticating with a stale one.
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${response.status}`);
  }
  const json = await response.json();
  return json.data;
}

export interface ConversationSummary {
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation extends ConversationSummary {
  messages: unknown[];
}

export const fetchConversations = (): Promise<ConversationSummary[]> =>
  request<ConversationSummary[]>(BASE());

export const fetchConversation = (documentId: string): Promise<Conversation> =>
  request<Conversation>(`${BASE()}/${documentId}`);

export const createConversation = (data: {
  title?: string;
  messages?: unknown[];
}): Promise<Conversation> =>
  request<Conversation>(BASE(), { method: 'POST', body: JSON.stringify(data) });

export const updateConversation = (
  documentId: string,
  data: { title?: string; messages?: unknown[] },
): Promise<Conversation> =>
  request<Conversation>(`${BASE()}/${documentId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteConversation = (documentId: string): Promise<void> =>
  request<void>(`${BASE()}/${documentId}`, { method: 'DELETE' });
