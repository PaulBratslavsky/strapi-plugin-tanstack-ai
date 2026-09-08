import { useCallback, useEffect, useRef, useState } from 'react';
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

  /**
   * The active id as a REF, and every save queued behind the last one.
   *
   * Both exist for one bug, which the browser test caught as two identical
   * conversations in the sidebar. Saving is triggered by the streaming edge,
   * and that edge can fire more than once for a single turn — a tool call ends
   * a step, and React's development StrictMode re-invokes effects besides. Two
   * saves then start before `activeId` STATE has updated from the first, so
   * both read `null` from their closure, both take the create branch, and the
   * conversation is duplicated.
   *
   * The ref is written synchronously the moment a conversation is created, and
   * the chain guarantees the second save reads it only after the first has
   * finished — so it updates the row the first one made.
   */
  const activeIdRef = useRef<string | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Has the user already chosen a conversation (or started a new one)?
   *
   * The mount load auto-opens the most recent conversation, and it resolves
   * asynchronously. Someone who clicks "New chat" in that window had their
   * choice silently overwritten when the fetch landed — and because the
   * clobber restored an id, the next reply was saved into the conversation
   * they thought they had left. A browser test caught it as a PUT where a POST
   * was expected.
   */
  const userChoseRef = useRef(false);

  // On mount: list them, and open the most recent, so the panel resumes where
  // the user left off rather than presenting an empty box beside a full list.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchConversations();
        if (cancelled) return;
        setConversations(list);
        if (list.length === 0) return;

        const newest = await fetchConversation(list[0].documentId);
        // Re-checked AFTER the await, not before: the user may have acted
        // while this request was in flight, and their choice wins.
        if (cancelled || userChoseRef.current) return;
        activeIdRef.current = newest.documentId;
        setActiveId(newest.documentId);
        setInitialMessages((newest.messages as Message[]) ?? []);
      } catch (cause) {
        if (!cancelled) setError(`Could not load history: ${String(cause)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectConversation = useCallback(async (documentId: string) => {
    userChoseRef.current = true;
    try {
      const conversation = await fetchConversation(documentId);
      activeIdRef.current = documentId;
      setActiveId(documentId);
      setInitialMessages((conversation.messages as Message[]) ?? []);
      setError(null);
    } catch (cause) {
      setError(`Could not open that conversation: ${String(cause)}`);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    userChoseRef.current = true;
    activeIdRef.current = null;
    setActiveId(null);
    setInitialMessages([]);
  }, []);

  /**
   * Persist the transcript. Called when a turn finishes, not on every token.
   *
   * The first save CREATES and adopts the new id, so the next save updates the
   * same row instead of forking a second conversation on every reply.
   */
  const saveMessages = useCallback(async (messages: Message[]) => {
    if (messages.length === 0) return;
    const title = titleFrom(messages);

    /*
     * Queued behind whatever is already in flight, and reading the id from the
     * ref rather than this closure — see the refs above.
     *
     * `prefer-await` and `no-nested-functions` are off for this block because
     * the CHAIN is the mechanism. `chainRef` holds the tail of a queue;
     * awaiting it instead would serialise this caller rather than the saves,
     * which is the opposite of the point. Two saves racing is how the same
     * conversation once got created twice.
     */
    /* eslint-disable unicorn/prefer-await, sonarjs/no-nested-functions */
    const run = chainRef.current.then(async () => {
      const current = activeIdRef.current;
      try {
        if (current) {
          await updateConversation(current, { title, messages });
          setConversations((prev) =>
            prev.map((c) =>
              c.documentId === current
                ? { ...c, title, updatedAt: new Date().toISOString() }
                : c,
            ),
          );
        } else {
          const created = await createConversation({ title, messages });
          // Written SYNCHRONOUSLY, before any await: the next queued save must
          // see this id, and React state would not have updated by then.
          activeIdRef.current = created.documentId;
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
    });

    // The chain must not break on a failed save, or every later save is
    // dropped with it.
    chainRef.current = run.catch(() => {});
    /* eslint-enable unicorn/prefer-await, sonarjs/no-nested-functions */
    return run;
  }, []);

  const removeConversation = useCallback(
    async (documentId: string) => {
      try {
        await deleteConversation(documentId);
        setConversations((prev) => prev.filter((c) => c.documentId !== documentId));
        if (activeIdRef.current === documentId) {
          activeIdRef.current = null;
          setActiveId(null);
          setInitialMessages([]);
        }
      } catch (cause) {
        setError(`Could not delete that conversation: ${String(cause)}`);
      }
    },
    [],
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
