import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';
import { loadAI } from './tanstack-ai';

/**
 * Note tools — chat only, for the same reason the memory tools are: a note
 * belongs to an admin USER, and an MCP caller is a token with no identity.
 *
 * Ported from the reference plugin's `tool-logic/save-note.ts` and
 * `recall-notes.ts`.
 *
 * ONE DELIBERATE DIVERGENCE, and it matters more here than anywhere else in
 * this port. The reference's `recallNotes` returns every matching note in
 * full. A note is a markdown document — the whole point is that it can be long
 * — so recalling twenty of them can put more text in the context window than
 * the conversation itself, and the failure is not an error: the model simply
 * runs out of room and starts forgetting the actual question. This version
 * caps the number of notes and truncates each one, and says so in the result
 * so the model knows to narrow its search or ask for a note by title rather
 * than assuming it has read everything.
 */

const CONTENT_TYPE = 'plugin::tanstack-ai.note' as const;

const CATEGORIES = ['research', 'snippet', 'idea', 'reference'] as const;

/** Notes returned by one recall. */
const MAX_NOTES = 10;
/** Characters of each note body a recall will return. */
const MAX_NOTE_CHARS = 2000;

export interface NoteToolOptions {
  adminUserId: number;
}

export async function buildNoteTools(strapi: Core.Strapi, options: NoteToolOptions) {
  const { toolDefinition } = await loadAI();
  const { adminUserId } = options;

  const saveNote = toolDefinition({
    name: 'save_note',
    description:
      'Save a research note, code snippet, idea or reference for this user, as markdown. Use it ' +
      'when the user asks to keep something, or when a piece of research is worth having later — ' +
      'not for facts about the user themselves, which belong in save_memory.',
    inputSchema: z.object({
      title: z.string().optional().describe('A short label, e.g. "Strapi lifecycle hooks".'),
      content: z
        .string()
        .min(1)
        .describe('The note itself, in markdown. Code blocks, lists and links are fine.'),
      category: z
        .enum(CATEGORIES)
        .optional()
        .describe('One of: research, snippet, idea, reference. Defaults to research.'),
      tags: z.string().optional().describe('Comma-separated tags, e.g. "strapi, api".'),
      source: z
        .string()
        .optional()
        .describe('Where it came from — a URL, or "conversation".'),
    }) as never,
    outputSchema: z.object({
      saved: z.boolean(),
      title: z.string(),
    }) as never,
  });

  const recallNotes = toolDefinition({
    name: 'recall_notes',
    description:
      'Search this user\'s saved notes by text, category or tag. Results are capped and each ' +
      'note body may be truncated, so narrow the search rather than assuming you have seen ' +
      'everything.',
    inputSchema: z.object({
      query: z.string().optional().describe('Substring to match in the title or body.'),
      category: z.enum(CATEGORIES).optional().describe('Restrict to one category.'),
      tag: z.string().optional().describe('Match within the comma-separated tags.'),
    }) as never,
    outputSchema: z.object({
      notes: z.array(
        z.object({
          title: z.string(),
          content: z.string(),
          category: z.string(),
          tags: z.string(),
          source: z.string(),
          truncated: z.boolean(),
        }),
      ),
      count: z.number(),
      more: z.boolean().describe('True when more notes matched than were returned.'),
    }) as never,
  });

  const save = (async (args: {
    title?: string;
    content: string;
    category?: string;
    tags?: string;
    source?: string;
  }) => {
    const title = args.title || '';
    await strapi.documents(CONTENT_TYPE).create({
      data: {
        title,
        content: args.content,
        category: args.category || 'research',
        tags: args.tags || '',
        source: args.source || 'conversation',
        adminUserId,
      },
    });
    return { saved: true, title };
  }) as never;

  const recall = (async (args: { query?: string; category?: string; tag?: string }) => {
    const filters: Record<string, unknown> = { adminUserId };
    if (args.category) filters.category = args.category;
    if (args.tag) filters.tags = { $containsi: args.tag };
    if (args.query) {
      // Title OR body: a note is often findable by one and not the other.
      filters.$or = [
        { title: { $containsi: args.query } },
        { content: { $containsi: args.query } },
      ];
    }

    // One more than the cap, so `more` reports whether anything was left
    // behind rather than guessing from a full page.
    const rows = (await strapi.documents(CONTENT_TYPE).findMany({
      filters,
      fields: ['title', 'content', 'category', 'tags', 'source'],
      sort: { createdAt: 'desc' },
      limit: MAX_NOTES + 1,
    } as never)) as unknown as Array<{
      title?: string;
      content: string;
      category: string;
      tags?: string;
      source?: string;
    }>;

    const more = rows.length > MAX_NOTES;
    const notes = rows.slice(0, MAX_NOTES).map((row) => {
      const truncated = row.content.length > MAX_NOTE_CHARS;
      return {
        title: row.title || '',
        content: truncated ? `${row.content.slice(0, MAX_NOTE_CHARS)}…` : row.content,
        category: row.category,
        tags: row.tags || '',
        source: row.source || '',
        truncated,
      };
    });

    return { notes, count: notes.length, more };
  }) as never;

  return [saveNote.server(save), recallNotes.server(recall)];
}
