import { useCallback, useEffect, useState } from 'react';
import {
  createMemory as createMemoryRequest,
  deleteMemory,
  fetchMemories,
  updateMemory as updateMemoryRequest,
  type Memory,
} from '../utils/memories-api';

/**
 * The caller's memories.
 *
 * Ported from the reference plugin's `hooks/useMemories.ts`. `refresh` is the
 * part that matters to the panel: memories are written by the MODEL during a
 * turn, so nothing on the client knows a new one exists until it asks. The
 * chat re-runs this when a turn ends.
 */
export function useMemories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMemories(await fetchMemories());
      setError(null);
    } catch (cause) {
      setError(`Could not load memories: ${String(cause)}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addMemory = useCallback(async (data: { content: string; category?: string }) => {
    try {
      const created = await createMemoryRequest(data);
      setMemories((prev) => [created, ...prev]);
      setError(null);
    } catch (cause) {
      setError(`Could not save that memory: ${String(cause)}`);
    }
  }, []);

  const editMemory = useCallback(
    async (documentId: string, data: { content?: string; category?: string }) => {
      try {
        const updated = await updateMemoryRequest(documentId, data);
        setMemories((prev) =>
          prev.map((memory) => (memory.documentId === documentId ? { ...memory, ...updated } : memory)),
        );
        setError(null);
      } catch (cause) {
        setError(`Could not update that memory: ${String(cause)}`);
      }
    },
    [],
  );

  const removeMemory = useCallback(async (documentId: string) => {
    try {
      await deleteMemory(documentId);
      setMemories((prev) => prev.filter((memory) => memory.documentId !== documentId));
      setError(null);
    } catch (cause) {
      setError(`Could not delete that memory: ${String(cause)}`);
    }
  }, []);

  return { memories, error, addMemory, editMemory, removeMemory, refresh: load };
}
