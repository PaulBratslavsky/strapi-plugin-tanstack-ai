import type { Core, Modules } from '@strapi/strapi';
import { oversizeNotice } from '../lib/size-guard';
import { aggregateContent } from './aggregate-content';
import { listContentTypes } from './list-content-types';
import { searchContent } from './search-content';

/**
 * The tool registry — ONE list, read by both `bootstrap` (which registers the
 * tools) and `register` (which registers a permission action per tool).
 *
 * It is one list because it was two: `register.ts` carried a hand-maintained
 * `TOOL_NAMES` array beside `bootstrap.ts`'s array of tool objects. Adding a
 * third tool and updating only one of them yields a tool that registers and is
 * then invisible in `tools/list`, with no error anywhere — the exact silent
 * failure this plugin has already paid for once. Now there is nothing to keep
 * in step.
 */
export const ALL_TOOLS = [listContentTypes, searchContent, aggregateContent];

/** A tool's own name, before any configured prefix. */
export const toolNames = (): string[] => ALL_TOOLS.map((tool) => tool.name);

type ToolDefinition = (typeof ALL_TOOLS)[number];

/**
 * Apply the operator's `mcp` config to a tool, ready for registration.
 *
 * TWO THINGS HAPPEN HERE, and both were config keys the plugin documented,
 * validated, and then ignored — `toolPrefix` and `sizeLimitBytes` were dead
 * settings, which is worse than absent ones: an operator who sets a prefix to
 * avoid a collision gets no prefix and no warning.
 *
 * The prefix changes the MCP-VISIBLE NAME ONLY. Permission actions stay keyed
 * to the bare name (see `tool-permissions.ts`), because an action id that
 * moved with the prefix would silently orphan every existing grant the moment
 * an operator changed it — the tool would vanish from `tools/list` and the
 * checkbox that used to enable it would still be ticked.
 */
export function prepareTool(tool: ToolDefinition, config: { toolPrefix?: string; sizeLimitBytes: number }) {
  const prefix = config.toolPrefix?.trim();
  const name = prefix ? `${prefix}_${tool.name}` : tool.name;

  return {
    ...tool,
    name,
    // Wrapping the handler rather than each tool guarding itself: the limit is
    // a property of the transport, not of what any one tool means to return.
    createHandler: (strapi: Core.Strapi, handlerContext: Modules.MCP.McpHandlerContext) => {
      // Both arguments are forwarded. `handlerContext` carries the calling
      // user and session; dropping it would work today only because these two
      // tools ignore it, and break silently the first time one does not.
      const handler = tool.createHandler(strapi, handlerContext);
      return async (params: Parameters<typeof handler>[0]) => {
        const result = await handler(params as never);
        const structured = (result as { structuredContent?: unknown }).structuredContent;
        // An error result carries no structuredContent and is already small.
        if (structured === undefined) return result;
        return oversizeNotice(structured, name, config.sizeLimitBytes) ?? result;
      };
    },
  } as unknown as Modules.MCP.McpToolDefinition;
}
