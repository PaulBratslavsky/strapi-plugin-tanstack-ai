import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';
import { loadAI } from './tanstack-ai';

/**
 * Memory tools — CHAT ONLY, never MCP.
 *
 * Ported from the reference plugin's `tool-logic/save-memory.ts` and
 * `recall-memories.ts`, including the decision their definitions encode as
 * `internal: true`: these tools are not exposed over MCP.
 *
 * The reason is that a memory belongs to an ADMIN USER, and an MCP caller is
 * an admin API TOKEN. A token has grants but no identity — there is no "user"
 * whose preferences these are — so over MCP either every token would share one
 * pool of memories, or the tool would have no owner to attribute a write to.
 * Neither is a thing to offer. In the chat panel the caller is a logged-in
 * person, so `adminUserId` is real.
 *
 * That also means these tools are EXEMPT from the RBAC filter that gates the
 * MCP-backed tools. `chat-tools.ts` warns why: gating a tool behind an action
 * nobody registered withholds it from everyone, silently, including a Super
 * Admin. These tools touch only the caller's own rows, so the session itself
 * is the authorisation.
 */

const CONTENT_TYPE = 'plugin::tanstack-ai.memory' as const;

/** Matches the content type's enum; an unknown value would fail validation. */
const CATEGORIES = ['general', 'preference', 'personal', 'project'] as const;

/**
 * A memory is a sentence, not a document.
 *
 * Every memory is replayed in the system prompt of every future turn, so
 * length here is a tax on all of them. Capped rather than trimmed silently, so
 * the model is told and can write a shorter one.
 */
const MAX_CONTENT = 500;

/** Ceiling on how many memories a recall will return in one call. */
const MAX_RECALL = 100;

export interface MemoryToolOptions {
  /** The admin whose memories these are. Without it the tools are not built. */
  adminUserId: number;
}

export async function buildMemoryTools(strapi: Core.Strapi, options: MemoryToolOptions) {
  const { toolDefinition } = await loadAI();
  const { adminUserId } = options;

  const saveMemory = toolDefinition({
    name: 'save_memory',
    description:
      'Save a fact or preference about this user to long-term memory, so it is available in ' +
      'future conversations. Use it when the user states something durable about themselves, ' +
      'their project or how they want you to respond. Keep each memory to one short factual ' +
      'sentence. Do NOT save transient details of the current task, and do not save anything ' +
      'the user asked you to keep private.',
    inputSchema: z.object({
      content: z
        .string()
        .min(1)
        .max(MAX_CONTENT)
        .describe(
          'One short factual sentence, e.g. "Prefers short answers" or "Works on the pricing page".',
        ),
      category: z
        .enum(CATEGORIES)
        .optional()
        .describe('One of: general, preference, personal, project. Defaults to general.'),
    }) as never,
    outputSchema: z.object({
      saved: z.boolean(),
      content: z.string(),
    }) as never,
  });

  const recallMemories = toolDefinition({
    name: 'recall_memories',
    description:
      'Look up facts previously saved about this user. Saved memories are already included in ' +
      'your instructions, so use this only to search for something specific or to confirm what ' +
      'is stored — not routinely at the start of a turn.',
    inputSchema: z.object({
      query: z.string().optional().describe('Substring to match against memory content.'),
      category: z.enum(CATEGORIES).optional().describe('Restrict to one category.'),
    }) as never,
    outputSchema: z.object({
      memories: z.array(z.object({ content: z.string(), category: z.string() })),
      count: z.number(),
    }) as never,
  });

  const save = (async (args: { content: string; category?: string }) => {
    await strapi.documents(CONTENT_TYPE).create({
      data: {
        content: args.content,
        category: args.category || 'general',
        adminUserId,
      },
    });
    // Returns what was stored rather than a bare true: the model's next
    // sentence usually tells the user what it remembered, and it should be
    // quoting the record rather than its own intention.
    return { saved: true, content: args.content };
  }) as never;

  const recall = (async (args: { query?: string; category?: string }) => {
    const filters: Record<string, unknown> = { adminUserId };
    if (args.category) filters.category = args.category;
    if (args.query) filters.content = { $containsi: args.query };

    const rows = await strapi.documents(CONTENT_TYPE).findMany({
      filters,
      fields: ['content', 'category'],
      sort: { createdAt: 'desc' },
      limit: MAX_RECALL,
    } as never);

    const memories = (rows as unknown as Array<{ content: string; category: string }>).map((row) => ({
      content: row.content,
      category: row.category,
    }));
    return { memories, count: memories.length };
  }) as never;

  return [saveMemory.server(save), recallMemories.server(recall)];
}

/**
 * The memories to put in front of the model before it answers.
 *
 * Carried over from the reference's chat service, and it is the half of this
 * feature that actually works: a `recall_memories` tool only helps when the
 * model decides to call it, and a model that does not know it has memories has
 * no reason to. Injecting them means saved facts shape every answer without
 * costing a tool round trip — the recall tool is then for searching, not for
 * routine lookup.
 */
export async function memoryPreamble(
  strapi: Core.Strapi,
  adminUserId: number,
): Promise<string> {
  try {
    const rows = await strapi.documents(CONTENT_TYPE).findMany({
      filters: { adminUserId },
      fields: ['content', 'category'],
      sort: { createdAt: 'desc' },
      limit: MAX_RECALL,
    } as never);

    const memories = rows as unknown as Array<{ content: string; category: string }>;
    if (memories.length === 0) return '';

    const lines = memories.map((row) => `- [${row.category}] ${row.content}`);
    return (
      '\n\nWhat you have previously saved about this user. Treat these as background ' +
      'you already know; use them to personalise your answers, and do not repeat them back ' +
      'unless asked:\n' +
      lines.join('\n')
    );
  } catch (error) {
    // Never fail a chat turn because memories could not be read. An answer
    // without them is worse than one with; no answer at all is worse still.
    strapi.log.warn(
      `[tanstack-ai] could not load memories for the system prompt: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return '';
  }
}
