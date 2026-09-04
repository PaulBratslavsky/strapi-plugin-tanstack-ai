import { useEffect, useState } from 'react';
import {
  Button,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Td,
  Textarea,
  Tr,
  Typography,
} from '@strapi/design-system';
import { useMemories } from '../hooks/useMemories';
import type { Memory } from '../utils/memories-api';
import { useStoreList } from './store/useStoreList';
import { ActionBtn, Clamp, DeleteBtn, formatDate, StoreShell } from './store/StoreShell';

/**
 * Manage everything the assistant has remembered about you.
 *
 * Ported from the reference plugin's `MemoryStorePage`. The panel beside the
 * chat is for glancing and deleting; this is for reading the whole list,
 * searching it, and correcting what the model wrote — which matters because
 * these are claims ABOUT the user that get replayed into every future turn. A
 * wrong one is not a stale cache entry; it is the assistant confidently
 * repeating something untrue.
 */

const CATEGORIES = ['general', 'preference', 'personal', 'project'] as const;

interface MemoryModalProps {
  memory: Memory | null;
  open: boolean;
  onClose: () => void;
  onSave: (data: { content: string; category: string }, documentId?: string) => void;
}

function MemoryModal({ memory, open, onClose, onSave }: MemoryModalProps) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<string>('general');

  // Reset whenever the modal opens, so a previous edit never shows for a frame
  // in a form that is meant to be blank.
  useEffect(() => {
    if (!open) return;
    setContent(memory?.content ?? '');
    setCategory(memory?.category ?? 'general');
  }, [open, memory]);

  return (
    <Modal.Root open={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{memory ? 'Edit memory' : 'Add memory'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" gap={4} alignItems="stretch">
            <Field.Root>
              <Field.Label>What should be remembered</Field.Label>
              <Textarea
                placeholder="One short factual sentence, e.g. Prefers short answers"
                value={content}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setContent(event.target.value)
                }
                style={{ minHeight: 120 }}
              />
              <Field.Hint>
                Replayed into every future conversation, so keep it short and true.
              </Field.Hint>
            </Field.Root>
            <Field.Root>
              <Field.Label>Category</Field.Label>
              <SingleSelect value={category} onChange={(value: string) => setCategory(value)}>
                {CATEGORIES.map((option) => (
                  <SingleSelectOption key={option} value={option}>
                    {option}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={content.trim().length === 0}
            onClick={() => {
              onSave({ content, category }, memory?.documentId);
              onClose();
            }}
          >
            Save
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

export function MemoryStorePage() {
  const { memories, addMemory, editMemory, removeMemory } = useMemories();
  const [editing, setEditing] = useState<Memory | null>(null);
  const [open, setOpen] = useState(false);

  const list = useStoreList(
    memories,
    (memory, query) =>
      memory.content.toLowerCase().includes(query) ||
      memory.category.toLowerCase().includes(query),
  );

  return (
    <>
      <StoreShell
        title="Memories"
        subtitle={`${memories.length} remembered about you`}
        primaryAction={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Add memory
          </Button>
        }
        searchPlaceholder="Search memories…"
        search={list.search}
        onSearch={list.setSearch}
        columns={['Memory', 'Category', 'Saved', 'Actions']}
        page={list.page}
        pageCount={list.pageCount}
        onPage={list.setPage}
        isEmpty={list.visible.length === 0}
        empty={
          list.search
            ? 'No memories match that search.'
            : 'Nothing remembered yet. Tell the assistant something about how you work.'
        }
      >
        {list.visible.map((memory) => (
          <Tr key={memory.documentId}>
            <Td>
              <Clamp>
                <Typography textColor="neutral800">{memory.content}</Typography>
              </Clamp>
            </Td>
            <Td>
              <Typography textColor="neutral600">{memory.category}</Typography>
            </Td>
            <Td>
              <Typography textColor="neutral600">{formatDate(memory.createdAt)}</Typography>
            </Td>
            <Td>
              <Flex gap={1}>
                <ActionBtn
                  type="button"
                  aria-label={`Edit memory: ${memory.content}`}
                  onClick={() => {
                    setEditing(memory);
                    setOpen(true);
                  }}
                >
                  ✎
                </ActionBtn>
                <DeleteBtn
                  type="button"
                  aria-label={`Delete memory: ${memory.content}`}
                  onClick={() => removeMemory(memory.documentId)}
                >
                  ✕
                </DeleteBtn>
              </Flex>
            </Td>
          </Tr>
        ))}
      </StoreShell>

      <MemoryModal
        memory={editing}
        open={open}
        onClose={() => setOpen(false)}
        onSave={(data, documentId) => {
          if (documentId) editMemory(documentId, data);
          else addMemory(data);
        }}
      />
    </>
  );
}

export default MemoryStorePage;
