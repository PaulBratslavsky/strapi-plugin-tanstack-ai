import { useCallback, useEffect, useState } from 'react';
import {
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  updateConversation,
  type ConversationSummary,
} from '../utils/conversations-api';
import { messageText, type Message } from './chat-messages';

/**
 * Conversation list, selection, and saving.
 *
 * Ported from the reference plugin's `hooks/useConversations.ts`.
 *
 * WHY NOT THE SDK'S OWN PERSISTENCE. `@tanstack/ai-client` can hydrate a
 * transcript itself (`persistence: true` plus a `hydrate(threadId)` on the
 * connection adapter). It hydrates ONE thread, though, and the thing this
 * feature is actually for is the sidebar — listing conversations, switching
 * between them, deleting one. That needs list/select/delete endpoints
 * regardless, and once they exist, having the SDK own half the state and this
 * hook the other half is two sources of truth for one transcript.
 *
 * So the reference's shape is kept: the hook owns history, `useChat` owns the
 * live turn, and `setMessages` is the seam between them.
 */

/** A title has to fit a 260px sidebar row; the rest is an ellipsis. */
const MAX_TITLE = 80;

function titleFrom(messages: Message[]): string {
  const firstUser = messages.find((message) => message.role === 'user');
  const text = firstUser ? messageText(firstUser) : '';
  if (!text) return 'New conversation';
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE)}…` : text;
}

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  // On mount: list them, and open the most recent, so the panel resumes where
  // the user left off rather than presenting an empty box beside a full list.
  useEffect(() => {
    let cancelled = false;
    fetchConversations()
      .then(async (list) => {
        if (cancelled) return;
        setConversations(list);
        if (list.length === 0) return;
        const newest = await fetchConversation(list[0].documentId);
        if (cancelled) return;
        setActiveId(newest.documentId);
        setInitialMessages((newest.messages as Message[]) ?? []);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(`Could not load history: ${String(cause)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectConversation = useCallback(async (documentId: string) => {
    try {
      const conversation = await fetchConversation(documentId);
      setActiveId(documentId);
      setInitialMessages((conversation.messages as Message[]) ?? []);
      setError(null);
    } catch (cause) {
      setError(`Could not open that conversation: ${String(cause)}`);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    setActiveId(null);
    setInitialMessages([]);
  }, []);

  /**
   * Persist the transcript. Called when a turn finishes, not on every token.
   *
   * The first save CREATES and adopts the new id, so the next save updates the
   * same row instead of forking a second conversation on every reply.
   */
  const saveMessages = useCallback(
    async (messages: Message[]) => {
      if (messages.length === 0) return;
      const title = titleFrom(messages);

      try {
        if (activeId) {
          await updateConversation(activeId, { title, messages });
          setConversations((prev) =>
            prev.map((c) =>
              c.documentId === activeId
                ? { ...c, title, updatedAt: new Date().toISOString() }
                : c,
            ),
          );
        } else {
          const created = await createConversation({ title, messages });
          // LOAD-BEARING, and it looks redundant. Adopting the new id changes
          // `activeId`, which re-runs the panel's seeding effect — and that
          // effect writes `initialMessages` into the transcript. Left at the
          // empty array this conversation started from, it would wipe the very
          // messages that were just saved, one render after saving them.
          setInitialMessages(messages);
          setActiveId(created.documentId);
          setConversations((prev) => [
            {
              documentId: created.documentId,
              title: created.title,
              createdAt: created.createdAt,
              updatedAt: created.updatedAt,
            },
            ...prev,
          ]);
        }
        setError(null);
      } catch (cause) {
        // Surfaced rather than logged: a chat that silently stops saving looks
        // identical to one that is saving, until the page is reloaded.
        setError(`Could not save this conversation: ${String(cause)}`);
      }
    },
    [activeId],
  );

  const removeConversation = useCallback(
    async (documentId: string) => {
      try {
        await deleteConversation(documentId);
        setConversations((prev) => prev.filter((c) => c.documentId !== documentId));
        if (activeId === documentId) {
          setActiveId(null);
          setInitialMessages([]);
        }
      } catch (cause) {
        setError(`Could not delete that conversation: ${String(cause)}`);
      }
    },
    [activeId],
  );

  return {
    conversations,
    activeId,
    initialMessages,
    error,
    selectConversation,
    startNewConversation,
    saveMessages,
    removeConversation,
  };
}
