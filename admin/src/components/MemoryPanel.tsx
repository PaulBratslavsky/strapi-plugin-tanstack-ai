import { useState } from 'react';
import { Box, Typography } from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import styled from 'styled-components';
import type { Memory } from '../utils/memories-api';

/**
 * What the assistant has remembered about you.
 *
 * Ported from the reference plugin's `MemoryPanel`, which collapses to zero
 * width rather than unmounting, and reveals delete on hover.
 *
 * Added here: a way to write one by hand. The model saves memories on its own,
 * but a person reading a list of claims about themselves should be able to add
 * to it directly rather than having to phrase a sentence that provokes the
 * model into saving something.
 */

const PanelRoot = styled.div<{ $open: boolean }>`
  width: ${({ $open }) => ($open ? '280px' : '0px')};
  min-width: ${({ $open }) => ($open ? '280px' : '0px')};
  display: flex;
  flex-direction: column;
  border-left: ${({ $open, theme }) =>
    $open ? `1px solid ${theme.colors.neutral200}` : 'none'};
  background: ${({ theme }) => theme.colors.neutral100};
  overflow: hidden;
  transition: width 0.2s ease, min-width 0.2s ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const PanelHeader = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral200};
`;

const MemoryList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
`;

const MemoryItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 16px;

  &:hover .memory-delete,
  & .memory-delete:focus-visible {
    opacity: 1;
  }
`;

const MemoryContent = styled.div`
  flex: 1;
  min-width: 0;
`;

const CategoryBadge = styled.span`
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: ${({ theme }) => theme.colors.neutral200};
  color: ${({ theme }) => theme.colors.neutral600};
  margin-bottom: 2px;
`;

const DeleteBtn = styled.button`
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: 2px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: ${({ theme }) => theme.colors.neutral500};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.neutral300};
    color: ${({ theme }) => theme.colors.danger600};
  }

  svg {
    width: 12px;
    height: 12px;
  }
`;

const AddRow = styled.form`
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral200};
`;

const AddInput = styled.input`
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: 12px;
`;

interface MemoryPanelProps {
  memories: Memory[];
  open: boolean;
  onAdd: (data: { content: string }) => void;
  onDelete: (documentId: string) => void;
}

export function MemoryPanel({ memories, open, onAdd, onDelete }: MemoryPanelProps) {
  const [draft, setDraft] = useState('');

  return (
    <PanelRoot $open={open} aria-hidden={!open}>
      <PanelHeader>
        <Typography variant="sigma" textColor="neutral600">
          MEMORIES ({memories.length})
        </Typography>
      </PanelHeader>

      <MemoryList>
        {memories.map((memory) => (
          <MemoryItem key={memory.documentId} data-memory>
            <MemoryContent>
              <CategoryBadge>{memory.category}</CategoryBadge>
              <Typography variant="omega" textColor="neutral800" style={{ display: 'block' }}>
                {memory.content}
              </Typography>
            </MemoryContent>
            <DeleteBtn
              type="button"
              className="memory-delete"
              onClick={() => onDelete(memory.documentId)}
              aria-label={`Delete memory: ${memory.content}`}
            >
              <Trash />
            </DeleteBtn>
          </MemoryItem>
        ))}

        {memories.length === 0 && (
          <Box padding={4}>
            <Typography variant="omega" textColor="neutral500">
              Nothing remembered yet. Tell the assistant something about how you work and it will
              save it here.
            </Typography>
          </Box>
        )}
      </MemoryList>

      <AddRow
        onSubmit={(event) => {
          event.preventDefault();
          const content = draft.trim();
          if (!content) return;
          onAdd({ content });
          setDraft('');
        }}
      >
        <AddInput
          aria-label="New memory"
          placeholder="Remember that…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </AddRow>
    </PanelRoot>
  );
}
