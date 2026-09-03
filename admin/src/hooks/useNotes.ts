import { useCallback, useEffect, useState } from 'react';
import {
  deleteNote,
  fetchNotes,
  updateNote as updateNoteRequest,
  type Note,
  type NoteInput,
} from '../utils/notes-api';

/**
 * The caller's research notes.
 *
 * Ported from the reference plugin's `hooks/useNotes.ts`. As with memories,
 * `refresh` is what keeps the panel honest: notes are written by the MODEL
 * during a turn, so the client cannot know a new one exists until it asks.
 */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes(await fetchNotes());
      setError(null);
    } catch (cause) {
      setError(`Could not load notes: ${String(cause)}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editNote = useCallback(async (documentId: string, data: NoteInput) => {
    try {
      const updated = await updateNoteRequest(documentId, data);
      setNotes((prev) =>
        prev.map((note) => (note.documentId === documentId ? { ...note, ...updated } : note)),
      );
      setError(null);
    } catch (cause) {
      setError(`Could not update that note: ${String(cause)}`);
    }
  }, []);

  const removeNote = useCallback(async (documentId: string) => {
    try {
      await deleteNote(documentId);
      setNotes((prev) => prev.filter((note) => note.documentId !== documentId));
      setError(null);
    } catch (cause) {
      setError(`Could not delete that note: ${String(cause)}`);
    }
  }, []);

  return { notes, error, editNote, removeNote, refresh: load };
}
