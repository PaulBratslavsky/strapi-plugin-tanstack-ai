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

/**
 * The row is a CONTAINER holding two siblings, not a button holding a button.
 *
 * Nesting them was a real bug with two faces. A button inside a button is
 * invalid HTML that browsers recover from unpredictably — and the accessible
 * name of the outer control then absorbs the inner one's label, so the row
 * announced itself as "<title> Delete conversation: <title>". A test looking
 * for the delete control by name matched BOTH elements, which read as a
 * duplicated conversation when nothing was duplicated.
 */
const ConversationItem = styled.div<{ $active: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 12px 0 0;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.neutral200 : 'transparent'};

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

const SelectBtn = styled.button`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 10px 0 10px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
`;

const DeleteBtn = styled.button`
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
            $active={conversation.documentId === activeId}
          >
            <SelectBtn type="button" onClick={() => onSelect(conversation.documentId)}>
              <TitleText variant="omega" textColor="neutral800">
                {conversation.title}
              </TitleText>
            </SelectBtn>
            <DeleteBtn
              type="button"
              className="delete-btn"
              aria-label={`Delete conversation: ${conversation.title}`}
              onClick={() => onDelete(conversation.documentId)}
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
