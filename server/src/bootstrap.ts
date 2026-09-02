import type { Core } from '@strapi/strapi';
import { readConfig } from './lib/plugin-config';

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

  strapi.log.info(
    `[tanstack-ai] MCP available; tool prefix "${config.mcp.toolPrefix}", ` +
      `chat ${config.chat.enabled ? 'ENABLED' : 'disabled'}`,
  );

  // Tools are registered here in the next step.
};

export default bootstrap;
