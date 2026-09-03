import { PLUGIN_ID } from '../pluginId';
import { authHeaders, backendURL } from './auth';

/** The notes endpoint. Same shape as the other two api modules. */

const BASE = () => `${backendURL()}/${PLUGIN_ID}/notes`;

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

export interface Note {
  documentId: string;
  title: string;
  content: string;
  category: string;
  tags: string;
  source: string;
  createdAt: string;
}

export type NoteInput = Partial<Omit<Note, 'documentId' | 'createdAt'>> & { content?: string };

export const fetchNotes = (): Promise<Note[]> => request<Note[]>(BASE());

export const createNote = (data: NoteInput): Promise<Note> =>
  request<Note>(BASE(), { method: 'POST', body: JSON.stringify(data) });

export const updateNote = (documentId: string, data: NoteInput): Promise<Note> =>
  request<Note>(`${BASE()}/${documentId}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteNote = (documentId: string): Promise<void> =>
  request<void>(`${BASE()}/${documentId}`, { method: 'DELETE' });
