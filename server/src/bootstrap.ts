import type { Core } from '@strapi/strapi';
import { readConfig } from './lib/plugin-config';
import { ALL_TOOLS, prepareTool } from './tools';
import { probeChat, recordChatStatus, type ChatStatus } from './lib/chat-status';

/**
 * Registration happens in BOOTSTRAP, not REGISTER.
 *
 * Strapi's official MCP server is itself a plugin, and `strapi.ai.mcp` only
 * exists once it has registered. `register` runs before that is guaranteed, so
 * registering there is a race that would work or not depending on plugin
 * ordering — the worst kind of bug to inherit.
 */
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const config = readConfig(strapi);

  // Measure once whether chat can actually run: config, plus the optional
  // @tanstack/* packages it loads. Never throws — chat is on by default, and a
  // tools-only host without a key or the packages must still boot.
  const chat = await probeChat(config.chat);
  recordChatStatus(chat);
  logChatStatus(strapi, chat);

  // The MCP server is optional in the host: `mcp.enabled` may be false in
  // config/server.ts, or the Strapi version may predate it. Tools simply have
  // nowhere to go then, which is not an error worth crashing a boot over.
  // `strapi.ai` is absent from Core.Strapi on versions before 5.47, which is
  // exactly the case this guard exists for — so the shape is named here rather
  // than asserted as `any`.
  const mcp = (strapi as Core.Strapi & { ai?: { mcp?: { registerTool: (tool: unknown) => void } } })
    .ai?.mcp;
  if (!mcp) {
    strapi.log.info(
      '[tanstack-ai] Strapi MCP server not available — no MCP tools registered. ' +
        'Enable it with `mcp: { enabled: true }` in config/server.ts.',
    );
    return;
  }

  // Each tool registers independently. The official registry throws
  // synchronously on a conflict — a duplicate name against another plugin or a
  // built-in — and one bad tool must not take Strapi's boot down with it.
  // `prepareTool` applies the operator's `mcp` config: the name prefix and the
  // result size limit. Both were previously documented and ignored.
  const tools = ALL_TOOLS.map((tool) => prepareTool(tool, config.mcp));
  let registered = 0;

  for (const tool of tools) {
    try {
      mcp.registerTool(tool);
      registered++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      strapi.log.warn(`[tanstack-ai] skipped tool "${tool.name}": ${message}`);
    }
  }

  strapi.log.info(`[tanstack-ai] registered ${registered}/${tools.length} MCP tool(s)`);
};

/**
 * One line, at the level it deserves: chat asked for but unable to run is a
 * warning an operator should see; chat turned off on purpose is not.
 */
function logChatStatus(strapi: Core.Strapi, chat: ChatStatus) {
  if (chat.ready) strapi.log.info('[tanstack-ai] chat ENABLED');
  else if (chat.enabled) strapi.log.warn(`[tanstack-ai] chat is on but not ready: ${chat.reason}`);
  else strapi.log.info('[tanstack-ai] chat disabled');
}

export default bootstrap;
