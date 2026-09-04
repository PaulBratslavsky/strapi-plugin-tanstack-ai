import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { PLUGIN_ID } from '../pluginId';
import type { Note, NoteInput } from '../utils/notes-api';

/**
 * Research notes the assistant has saved, and a modal to edit one.
 *
 * Ported from the reference plugin's `NotePanel` — the list, the category and
 * tag chips, the two-line preview, delete on hover, and the click-to-edit
 * modal with title / content / category / tags / source.
 *
 * The modal is the reason a note is not just a longer memory: a note is
 * material the user intends to USE later — a snippet to paste, research to
 * write up — so it has to be correctable. A model writing directly into a
 * store the user cannot edit is a store the user stops trusting.
 */

const CATEGORIES = ['research', 'snippet', 'idea', 'reference'] as const;

const PanelRoot = styled.div<{ $open: boolean }>`
  width: ${({ $open }) => ($open ? '300px' : '0px')};
  min-width: ${({ $open }) => ($open ? '300px' : '0px')};
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
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral200};
`;

/** To the full page, for when the panel is too small to manage in. */
const ManageLink = styled(Link)`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.primary600};
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    text-decoration: underline;
  }
`;

const NoteList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
`;

const NoteItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.neutral150};
  }

  &:hover .note-delete,
  & .note-delete:focus-visible {
    opacity: 1;
  }
`;

const NoteContent = styled.div`
  flex: 1;
  min-width: 0;
`;

const Chip = styled.span<{ $tag?: boolean }>`
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: ${({ $tag, theme }) => ($tag ? theme.colors.primary100 : theme.colors.neutral200)};
  color: ${({ $tag, theme }) => ($tag ? theme.colors.primary600 : theme.colors.neutral600)};
`;

const NoteTitle = styled(Typography)`
  display: block;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/** Two lines of the body, so a long note does not take over the list. */
const NotePreview = styled(Typography)`
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12px;
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

interface EditNoteModalProps {
  note: Note | null;
  onClose: () => void;
  onSave: (documentId: string, data: NoteInput) => void;
}

function EditNoteModal({ note, onClose, onSave }: EditNoteModalProps) {
  const [draft, setDraft] = useState<NoteInput>({});

  // Reset from the note each time one is opened, so the form never shows the
  // previous note's text for a frame.
  useEffect(() => {
    if (!note) return;
    setDraft({
      title: note.title ?? '',
      content: note.content,
      category: note.category,
      tags: note.tags ?? '',
      source: note.source ?? '',
    });
  }, [note]);

  const set = (key: keyof NoteInput) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal.Root open={note !== null} onOpenChange={(open: boolean) => !open && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Edit note</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" gap={4} alignItems="stretch">
            <Field.Root>
              <Field.Label>Title</Field.Label>
              <TextInput
                placeholder="Short label for the note"
                value={draft.title ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('title')(e.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Content</Field.Label>
              <Textarea
                placeholder="Note content (markdown)"
                value={draft.content ?? ''}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  set('content')(e.target.value)
                }
                style={{ minHeight: 180, fontFamily: 'monospace' }}
              />
            </Field.Root>
            <Flex gap={4} alignItems="flex-start">
              <Field.Root style={{ flex: 1 }}>
                <Field.Label>Category</Field.Label>
                <SingleSelect value={draft.category} onChange={set('category')}>
                  {CATEGORIES.map((category) => (
                    <SingleSelectOption key={category} value={category}>
                      {category}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
              <Field.Root style={{ flex: 1 }}>
                <Field.Label>Source</Field.Label>
                <TextInput
                  placeholder="conversation, or a URL"
                  value={draft.source ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    set('source')(e.target.value)
                  }
                />
              </Field.Root>
            </Flex>
            <Field.Root>
              <Field.Label>Tags</Field.Label>
              <TextInput
                placeholder="comma, separated"
                value={draft.tags ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('tags')(e.target.value)}
              />
            </Field.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!note || !draft.content?.trim()) return;
              onSave(note.documentId, draft);
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

interface NotePanelProps {
  notes: Note[];
  open: boolean;
  onEdit: (documentId: string, data: NoteInput) => void;
  onDelete: (documentId: string) => void;
}

export function NotePanel({ notes, open, onEdit, onDelete }: NotePanelProps) {
  const [editing, setEditing] = useState<Note | null>(null);

  return (
    <PanelRoot $open={open} aria-hidden={!open}>
      <PanelHeader>
        <Typography variant="sigma" textColor="neutral600">
          NOTES ({notes.length})
        </Typography>
        <ManageLink to={`/plugins/${PLUGIN_ID}/notes`}>Manage</ManageLink>
      </PanelHeader>

      <NoteList>
        {notes.map((note) => (
          <NoteItem
            key={note.documentId}
            data-note
            role="button"
            tabIndex={0}
            onClick={() => setEditing(note)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              setEditing(note);
            }}
          >
            <NoteContent>
              <Flex gap={1} wrap="wrap" style={{ marginBottom: 2 }}>
                <Chip>{note.category}</Chip>
                {(note.tags ?? '')
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((tag) => (
                    <Chip key={tag} $tag>
                      {tag}
                    </Chip>
                  ))}
              </Flex>
              {note.title && (
                <NoteTitle variant="omega" textColor="neutral800">
                  {note.title}
                </NoteTitle>
              )}
              <NotePreview variant="omega" textColor="neutral600">
                {note.content}
              </NotePreview>
            </NoteContent>
            <DeleteBtn
              type="button"
              className="note-delete"
              aria-label={`Delete note: ${note.title || note.content.slice(0, 40)}`}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(note.documentId);
              }}
            >
              <Trash />
            </DeleteBtn>
          </NoteItem>
        ))}

        {notes.length === 0 && (
          <Box padding={4}>
            <Typography variant="omega" textColor="neutral500">
              No notes yet. Ask the assistant to save a snippet, a finding or an idea and it will
              appear here.
            </Typography>
          </Box>
        )}
      </NoteList>

      <EditNoteModal note={editing} onClose={() => setEditing(null)} onSave={onEdit} />
    </PanelRoot>
  );
}
