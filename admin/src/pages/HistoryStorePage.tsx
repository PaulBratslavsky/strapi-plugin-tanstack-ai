import { useCallback, useEffect, useState } from 'react';
import { Button, Flex, Td, Tr, Typography } from '@strapi/design-system';
import { useNavigate } from 'react-router-dom';
import {
  deleteConversation,
  fetchConversations,
  type ConversationSummary,
} from '../utils/conversations-api';
import { PLUGIN_ID } from '../pluginId';
import { useStoreList } from './store/useStoreList';
import { Clamp, DeleteBtn, formatDate, StoreShell } from './store/StoreShell';

/**
 * Every conversation, paginated.
 *
 * The sidebar beside the chat lists them too, but it is a 260px column with no
 * search: fine for the last handful, useless once there are thirty. This is
 * the same data with somewhere to look for something.
 *
 * There is no "add" — a conversation is created by having one. The only
 * management it needs is finding an old one and getting rid of the rest.
 */
export function HistoryStorePage() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConversations(await fetchConversations());
      setError(null);
    } catch (cause) {
      setError(`Could not load history: ${String(cause)}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const list = useStoreList(conversations, (conversation, query) =>
    conversation.title.toLowerCase().includes(query),
  );

  const remove = async (documentId: string) => {
    try {
      await deleteConversation(documentId);
      setConversations((prev) => prev.filter((c) => c.documentId !== documentId));
    } catch (cause) {
      setError(`Could not delete that conversation: ${String(cause)}`);
    }
  };

  return (
    <StoreShell
      title="Chat history"
      subtitle={error ?? `${conversations.length} conversations`}
      searchPlaceholder="Search conversations…"
      search={list.search}
      onSearch={list.setSearch}
      columns={['Conversation', 'Started', 'Last message', 'Actions']}
      page={list.page}
      pageCount={list.pageCount}
      onPage={list.setPage}
      isEmpty={list.visible.length === 0}
      empty={list.search ? 'No conversations match that search.' : 'No conversations yet.'}
    >
      {list.visible.map((conversation) => (
        <Tr key={conversation.documentId}>
          <Td>
            <Clamp>
              <Typography textColor="neutral800">{conversation.title}</Typography>
            </Clamp>
          </Td>
          <Td>
            <Typography textColor="neutral600">{formatDate(conversation.createdAt)}</Typography>
          </Td>
          <Td>
            <Typography textColor="neutral600">{formatDate(conversation.updatedAt)}</Typography>
          </Td>
          <Td>
            <Flex gap={2}>
              {/*
                Opening deliberately goes back to the chat rather than showing
                the transcript here. A conversation is something you continue;
                a read-only copy of it in a table would be a second place for
                it to live and a second thing to keep in step.
              */}
              <Button
                variant="tertiary"
                onClick={() => navigate(`/plugins/${PLUGIN_ID}?conversation=${conversation.documentId}`)}
              >
                Open
              </Button>
              <DeleteBtn
                type="button"
                aria-label={`Delete conversation: ${conversation.title}`}
                onClick={() => remove(conversation.documentId)}
              >
                ✕
              </DeleteBtn>
            </Flex>
          </Td>
        </Tr>
      ))}
    </StoreShell>
  );
}

export default HistoryStorePage;
