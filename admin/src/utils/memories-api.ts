import { PLUGIN_ID } from '../pluginId';
import { authHeaders, backendURL } from './auth';

/**
 * The memories endpoint.
 *
 * Ported from the reference plugin's `utils/memories-api.ts`, same shape as
 * `conversations-api`: plain functions, wire format only, throws on failure so
 * the caller decides what a failure means.
 */

const BASE = () => `${backendURL()}/${PLUGIN_ID}/memories`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${response.status}`);
  }
  const json = await response.json();
  return json.data;
}

export interface Memory {
  documentId: string;
  content: string;
  category: string;
  createdAt: string;
}

export const fetchMemories = (): Promise<Memory[]> => request<Memory[]>(BASE());

export const createMemory = (data: { content: string; category?: string }): Promise<Memory> =>
  request<Memory>(BASE(), { method: 'POST', body: JSON.stringify(data) });

export const updateMemory = (
  documentId: string,
  data: { content?: string; category?: string },
): Promise<Memory> =>
  request<Memory>(`${BASE()}/${documentId}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteMemory = (documentId: string): Promise<void> =>
  request<void>(`${BASE()}/${documentId}`, { method: 'DELETE' });
