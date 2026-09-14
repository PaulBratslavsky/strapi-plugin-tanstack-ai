import type { Core } from '@strapi/strapi';
import { loadAI } from './tanstack-ai';
import { actionForTool } from './tool-permissions';
import { ALL_TOOLS } from '../tools';

/**
 * Offer the plugin's MCP tools to the in-admin chat.
 *
 * ONE DEFINITION, TWO CALLERS. These tools are written once, for Strapi's MCP
 * server, and this adapts them for TanStack AI's `chat({ tools })`. Writing a
 * second copy for chat would guarantee the two drift — the same tool answering
 * differently depending on whether you asked over MCP or in the admin panel is
 * a bug nobody would think to look for.
 *
 * IN-PROCESS, NOT OVER THE WIRE. The admin chat runs inside Strapi, so it
 * calls the handlers directly rather than making an MCP round trip back to
 * itself. MCP is how OTHER processes reach these tools; it is not a bus this
 * process should talk to itself over.
 */

/*
 * `ALL_TOOLS` comes from the registry in `../tools`, which is also what
 * bootstrap registers with MCP and what register derives permission actions
 * from. It used to be a third hand-maintained copy of the same list living
 * here — the drift that arrangement invites is a tool the chat can call and
 * MCP cannot, or vice versa, with nothing to notice it.
 *
 * The BARE definitions, deliberately: a configured `mcp.toolPrefix` renames
 * tools for MCP clients, and the in-admin chat is not one.
 */

/** Minimal shape of the CASL ability Strapi puts on `ctx.state.userAbility`. */
export interface CallerAbility {
  can: (action: string) => boolean;
}

/**
 * Build the tool set for one caller.
 *
 * FILTERED BY THE SAME ACTIONS THAT GATE MCP, evaluated against whoever is
 * asking: an admin's role grants here, an admin token's grants there. A tool
 * the caller could not reach over MCP should not become reachable just because
 * they opened the chat panel.
 *
 * A caveat worth stating, from the reference's experience: only gate tools
 * that HAVE a registered action. A tool with no action can never satisfy
 * `can()`, so gating it withholds it from everyone — including a Super Admin —
 * silently. Every tool here is MCP-exposed and has an action; if an
 * admin-chat-only tool is ever added, it must either register an action or be
 * explicitly exempt.
 */
export async function buildChatTools(
  strapi: Core.Strapi,
  options?: { ability?: CallerAbility; adminUserId?: number },
) {
  const { toolDefinition } = await loadAI();
  const ability = options?.ability;

  // The handler context MCP would have built for this caller: their ability
  // and their id. `search_content` reads with it, so the chat returns only the
  // content this admin's role can read in Content Manager — the same answer
  // they would get over MCP. It was `{}` in 1.0.0, which went unnoticed because
  // the tool never looked; now that it does, an empty context is refused
  // rather than treated as "unrestricted".
  const handlerContext = {
    ...(ability ? { userAbility: ability } : {}),
    user: { id: options?.adminUserId ?? 0 },
  } as never;

  const tools = [];

  for (const mcpTool of ALL_TOOLS) {
    if (ability && !ability.can(actionForTool(mcpTool.name))) {
      strapi.log.debug(`[tanstack-ai] withholding ${mcpTool.name} — caller lacks its permission`);
      continue;
    }

    const definition = toolDefinition({
      name: mcpTool.name,
      description: mcpTool.description,
      inputSchema: mcpTool.resolveInputSchema(handlerContext) as never,
      outputSchema: mcpTool.resolveOutputSchema(handlerContext) as never,
    });

    // The handler is asserted at this ONE boundary. Strapi's MCP definitions
    // and TanStack AI's tool definitions are two independently-generic type
    // systems describing the same runtime shape; the schemas above are already
    // opaque to both, so the inferred return here collapses to `never`.
    // Asserting once, here, is honest about where the bridge is — scattering
    // casts through the body would hide it.
    const bridge = (async (args: unknown) => {
      const handler = mcpTool.createHandler(strapi, handlerContext);
      const result = await handler({ args, extra: {} } as never);

      // The MCP return shape carries both a rendered `content` array and
      // `structuredContent`. A chat model wants the data, so unwrap it — and
      // surface the protocol's error branch as a THROWN error, which is what
      // the agent loop understands. Returning an error object as data would
      // have the model narrate the failure as a result.
      if ('isError' in result && result.isError) {
        const text = result.content?.[0];
        throw new Error(text && 'text' in text ? String(text.text) : `${mcpTool.name} failed`);
      }
      return (result as { structuredContent?: unknown }).structuredContent;
    }) as never;

    tools.push(definition.server(bridge));
  }

  return tools;
}
