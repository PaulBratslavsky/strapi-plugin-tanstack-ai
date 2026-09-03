/**
 * Admin routes.
 *
 * The chat route is registered CONDITIONALLY. With chat off there is no
 * endpoint, no dead surface to probe, and no way to reach the SDK loader — the
 * config flag is the boundary rather than a runtime check inside a handler
 * that exists regardless.
 */
import { readConfig } from '../../lib/plugin-config';

const chatRoutes = [
  {
    method: 'POST',
    path: '/chat',
    handler: 'chat.chat',
    config: {
      // Admin routes already require an authenticated admin session; no
      // additional policy is needed to reach chat itself. What the MODEL can
      // do is gated separately, by the per-tool RBAC actions.
      policies: [],
    },
  },
];

export default {
  type: 'admin',
  get routes() {
    // A getter, because Strapi reads this at load time and `strapi` is a
    // global by then. Evaluating the config eagerly at module scope would run
    // before the host's plugin config is merged.
    const enabled = (() => {
      try {
        return readConfig(global.strapi as never).chat.enabled;
      } catch {
        return false;
      }
    })();
    return enabled ? chatRoutes : [];
  },
};
