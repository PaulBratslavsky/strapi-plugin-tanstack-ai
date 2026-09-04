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
  TextInput,
  Tr,
  Typography,
} from '@strapi/design-system';
import { useNotes } from '../hooks/useNotes';
import type { Note, NoteInput } from '../utils/notes-api';
import { useStoreList } from './store/useStoreList';
import { ActionBtn, Clamp, DeleteBtn, formatDate, StoreShell } from './store/StoreShell';

/**
 * Manage saved research notes.
 *
 * Ported from the reference plugin's `NoteStorePage`. Notes differ from
 * memories in what they are FOR: a note is material the user intends to use
 * later — a snippet to paste, research to write up — so the page is a working
 * list with search, not just a record of what the model decided to keep.
 */

const CATEGORIES = ['research', 'snippet', 'idea', 'reference'] as const;

interface NoteModalProps {
  note: Note | null;
  open: boolean;
  onClose: () => void;
  onSave: (data: NoteInput, documentId?: string) => void;
}

function NoteModal({ note, open, onClose, onSave }: NoteModalProps) {
  const [draft, setDraft] = useState<NoteInput>({});

  useEffect(() => {
    if (!open) return;
    setDraft({
      title: note?.title ?? '',
      content: note?.content ?? '',
      category: note?.category ?? 'research',
      tags: note?.tags ?? '',
      source: note?.source ?? '',
    });
  }, [open, note]);

  const set = (key: keyof NoteInput) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal.Root open={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{note ? 'Edit note' : 'Add note'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" gap={4} alignItems="stretch">
            <Field.Root>
              <Field.Label>Title</Field.Label>
              <TextInput
                placeholder="Short label for the note"
                value={draft.title ?? ''}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  set('title')(event.target.value)
                }
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Content</Field.Label>
              <Textarea
                placeholder="Note content (markdown)"
                value={draft.content ?? ''}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  set('content')(event.target.value)
                }
                style={{ minHeight: 200, fontFamily: 'monospace' }}
              />
            </Field.Root>
            <Flex gap={4} alignItems="flex-start">
              <Field.Root style={{ flex: 1 }}>
                <Field.Label>Category</Field.Label>
                <SingleSelect value={draft.category} onChange={set('category')}>
                  {CATEGORIES.map((option) => (
                    <SingleSelectOption key={option} value={option}>
                      {option}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
              <Field.Root style={{ flex: 1 }}>
                <Field.Label>Source</Field.Label>
                <TextInput
                  placeholder="conversation, or a URL"
                  value={draft.source ?? ''}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    set('source')(event.target.value)
                  }
                />
              </Field.Root>
            </Flex>
            <Field.Root>
              <Field.Label>Tags</Field.Label>
              <TextInput
                placeholder="comma, separated"
                value={draft.tags ?? ''}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  set('tags')(event.target.value)
                }
              />
            </Field.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!draft.content?.trim()}
            onClick={() => {
              onSave(draft, note?.documentId);
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

export function NoteStorePage() {
  const { notes, addNote, editNote, removeNote } = useNotes();
  const [editing, setEditing] = useState<Note | null>(null);
  const [open, setOpen] = useState(false);

  const list = useStoreList(notes, (note, query) =>
    [note.title, note.content, note.category, note.tags, note.source]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  );

  return (
    <>
      <StoreShell
        title="Notes"
        subtitle={`${notes.length} saved`}
        primaryAction={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Add note
          </Button>
        }
        searchPlaceholder="Search notes…"
        search={list.search}
        onSearch={list.setSearch}
        columns={['Note', 'Category', 'Tags', 'Saved', 'Actions']}
        page={list.page}
        pageCount={list.pageCount}
        onPage={list.setPage}
        isEmpty={list.visible.length === 0}
        empty={
          list.search
            ? 'No notes match that search.'
            : 'No notes yet. Ask the assistant to save a snippet, a finding or an idea.'
        }
      >
        {list.visible.map((note) => (
          <Tr key={note.documentId}>
            <Td>
              <Clamp>
                {note.title && (
                  <Typography fontWeight="bold" textColor="neutral800">
                    {note.title}{' '}
                  </Typography>
                )}
                <Typography textColor="neutral600">{note.content}</Typography>
              </Clamp>
            </Td>
            <Td>
              <Typography textColor="neutral600">{note.category}</Typography>
            </Td>
            <Td>
              <Typography textColor="neutral600">{note.tags || '—'}</Typography>
            </Td>
            <Td>
              <Typography textColor="neutral600">{formatDate(note.createdAt)}</Typography>
            </Td>
            <Td>
              <Flex gap={1}>
                <ActionBtn
                  type="button"
                  aria-label={`Edit note: ${note.title || note.content.slice(0, 40)}`}
                  onClick={() => {
                    setEditing(note);
                    setOpen(true);
                  }}
                >
                  ✎
                </ActionBtn>
                <DeleteBtn
                  type="button"
                  aria-label={`Delete note: ${note.title || note.content.slice(0, 40)}`}
                  onClick={() => removeNote(note.documentId)}
                >
                  ✕
                </DeleteBtn>
              </Flex>
            </Td>
          </Tr>
        ))}
      </StoreShell>

      <NoteModal
        note={editing}
        open={open}
        onClose={() => setOpen(false)}
        onSave={(data, documentId) => {
          if (documentId) editNote(documentId, data);
          else addNote(data);
        }}
      />
    </>
  );
}

export default NoteStorePage;
