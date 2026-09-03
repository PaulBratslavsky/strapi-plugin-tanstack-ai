import { useCallback, useEffect, useMemo, useState } from 'react';
import { PLUGIN_ID } from '../pluginId';
import { fetchToolSources, type ToolSource } from '../utils/tool-sources-api';

/**
 * Which contributed tool sources are switched on.
 *
 * Ported from the reference plugin's `useToolSources`, including two choices
 * that are easy to get wrong:
 *
 * The selection lives in localStorage, not on the server. It is a per-person,
 * per-browser preference about how this panel behaves — not data about the
 * Strapi instance — and storing it server-side would make one admin's choice
 * everyone's.
 *
 * `enabledToolSources` is `undefined` until the fetch resolves, and that is
 * NOT the same as the empty array. Undefined means "not stated", and the
 * server offers everything; an empty array means the user turned everything
 * off. Sending `[]` while still loading would silently strip every contributed
 * tool from the first message of every session.
 */

const STORAGE_KEY = `${PLUGIN_ID}:enabledToolSources`;

function readStored(): Set<string> | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === 'string')) : null;
  } catch {
    // A private window, or a value from an older format. Treat as unset.
    return null;
  }
}

export function useToolSources() {
  const [sources, setSources] = useState<ToolSource[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(() => readStored() ?? new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchToolSources()
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        // First run: everything on. A source a user has never seen should
        // work, not sit switched off waiting to be discovered.
        if (readStored() === null) {
          const all = new Set(list.filter((s) => s.toggleable).map((s) => s.id));
          setEnabled(all);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify([...all]));
          } catch {
            // Not being able to remember the choice is not worth an error.
          }
        }
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(`Could not load tool sources: ${String(cause)}`);
        // Still "loaded": the picker shows nothing, and chat carries on with
        // every source rather than none.
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback((id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // As above.
      }
      return next;
    });
  }, []);

  const enabledToolSources = useMemo(
    () => (loaded ? [...enabled] : undefined),
    [enabled, loaded],
  );

  return { sources, enabled, enabledToolSources, toggle, error };
}
