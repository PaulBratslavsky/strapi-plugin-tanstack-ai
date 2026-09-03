import { PLUGIN_ID } from '../pluginId';
import { authHeaders, backendURL } from './auth';

/** What tools the chat can reach, grouped by where they come from. */

export interface ToolSummary {
  name: string;
  description: string;
}

export interface ToolSource {
  id: string;
  label: string;
  description: string;
  /** Built-in groups cannot be switched off; contributed ones can. */
  toggleable: boolean;
  tools: ToolSummary[];
}

export async function fetchToolSources(): Promise<ToolSource[]> {
  const response = await fetch(`${backendURL()}/${PLUGIN_ID}/tool-sources`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!response.ok) throw new Error(`GET tool-sources failed: ${response.status}`);
  const json = await response.json();
  return json.data ?? [];
}
