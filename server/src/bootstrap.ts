import type { Core } from '@strapi/strapi';
import { readConfig } from './lib/plugin-config';
import { ALL_TOOLS, prepareTool } from './tools';

/**
 * Registration happens in BOOTSTRAP, not REGISTER.
 *
 * Strapi's official MCP server is itself a plugin, and `strapi.ai.mcp` only
 * exists once it has registered. `register` runs before that is guaranteed, so
 * registering there is a race that would work or not depending on plugin
 * ordering — the worst kind of bug to inherit.
 */
const bootstrap = ({ strapi }: { strapi: Core.Strapi }) => {
  const config = readConfig(strapi);

  // The MCP server is optional in the host: `mcp.enabled` may be false in
  // config/server.ts, or the Strapi version may predate it. Tools simply have
  // nowhere to go then, which is not an error worth crashing a boot over.
  const mcp = (strapi as any).ai?.mcp;
  if (!mcp) {
    strapi.log.info(
      '[tanstack-ai] Strapi MCP server not available — no tools registered. ' +
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

  strapi.log.info(
    `[tanstack-ai] registered ${registered}/${tools.length} MCP tool(s); ` +
      `chat ${config.chat.enabled ? 'ENABLED' : 'disabled'}`,
  );
};

export default bootstrap;
