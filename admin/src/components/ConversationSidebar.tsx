import { Box, Typography } from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import styled from 'styled-components';
import type { ConversationSummary } from '../utils/conversations-api';

/**
 * The history sidebar.
 *
 * Ported from the reference plugin's `ConversationSidebar`. Two details worth
 * keeping: it collapses to zero width rather than unmounting, so the
 * transition is a width animation instead of a layout jump, and the delete
 * button only appears on hover — it sits inside the row that selects the
 * conversation, so a permanently visible one is a mis-click waiting to happen.
 */

const SidebarRoot = styled.div<{ $open: boolean }>`
  width: ${({ $open }) => ($open ? '260px' : '0px')};
  min-width: ${({ $open }) => ($open ? '260px' : '0px')};
  display: flex;
  flex-direction: column;
  border-right: ${({ $open, theme }) =>
    $open ? `1px solid ${theme.colors.neutral200}` : 'none'};
  background: ${({ theme }) => theme.colors.neutral100};
  overflow: hidden;
  transition: width 0.2s ease, min-width 0.2s ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const NewChatButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const ConversationList = styled.div`
  flex: 1;
  overflow-y: auto;
`;

const ConversationItem = styled.button<{ $active: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 10px 12px;
  border: none;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.neutral200 : 'transparent'};
  cursor: pointer;
  text-align: left;

  &:hover {
    background: ${({ theme }) => theme.colors.neutral200};
  }

  /* Also revealed on keyboard focus, or the delete action would be
     mouse-only. */
  &:hover .delete-btn,
  & .delete-btn:focus-visible {
    opacity: 1;
  }
`;

const DeleteBtn = styled.span`
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.neutral600};

  &:hover {
    background: ${({ theme }) => theme.colors.neutral300};
    color: ${({ theme }) => theme.colors.danger600};
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

const TitleText = styled(Typography)`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;

interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  open: boolean;
  onSelect: (documentId: string) => void;
  onNew: () => void;
  onDelete: (documentId: string) => void;
}

export function ConversationSidebar({
  conversations,
  activeId,
  open,
  onSelect,
  onNew,
  onDelete,
}: ConversationSidebarProps) {
  return (
    <SidebarRoot $open={open} aria-hidden={!open}>
      <Box padding={3}>
        <NewChatButton type="button" onClick={onNew}>
          <Plus />
          New Chat
        </NewChatButton>
      </Box>

      <ConversationList>
        {conversations.map((conversation) => (
          <ConversationItem
            key={conversation.documentId}
            type="button"
            $active={conversation.documentId === activeId}
            onClick={() => onSelect(conversation.documentId)}
          >
            <TitleText variant="omega" textColor="neutral800">
              {conversation.title}
            </TitleText>
            {/*
              A <span>, not a nested <button>: a button inside a button is
              invalid HTML and browsers recover from it unpredictably. The row
              is the button; this is a click target within it that stops
              propagation so selecting and deleting stay distinct.
            */}
            <DeleteBtn
              className="delete-btn"
              role="button"
              tabIndex={0}
              aria-label={`Delete conversation: ${conversation.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(conversation.documentId);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onDelete(conversation.documentId);
              }}
            >
              <Trash />
            </DeleteBtn>
          </ConversationItem>
        ))}

        {conversations.length === 0 && (
          <Box padding={4}>
            <Typography variant="omega" textColor="neutral500">
              No conversations yet
            </Typography>
          </Box>
        )}
      </ConversationList>
    </SidebarRoot>
  );
}
