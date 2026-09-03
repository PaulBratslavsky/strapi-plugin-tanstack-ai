/**
 * Admin routes.
 *
 * The chat route is registered CONDITIONALLY. With chat off there is no
 * endpoint, no dead surface to probe, and no way to reach the SDK loader — the
 * config flag is the boundary rather than a runtime check inside a handler
 * that exists regardless.
 */
import { readConfig } from '../../lib/plugin-config';

/**
 * Always available: the panel must be able to ask whether chat is on.
 */
const configRoute = {
  method: 'GET',
  path: '/config',
  handler: 'chat.config',
  config: {
    policies: [],
    // No session required. The admin asks this during register(), before
    // login, to decide whether to show the menu link at all. It returns a
    // single boolean that the menu's own presence would reveal anyway.
    auth: false,
  },
};

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

  // History. Registered alongside chat rather than always, because a
  // conversation store with no chat to fill it is dead surface — and every
  // handler here would 401 anyway, since they key off the admin session.
  //
  // No policies: each handler scopes its query to `ctx.state.user.id` and
  // re-checks ownership on any row it was given by id. Authorisation that
  // depends on the ROW cannot be expressed as a route policy.
  { method: 'GET', path: '/conversations', handler: 'conversation.find', config: { policies: [] } },
  { method: 'GET', path: '/conversations/:id', handler: 'conversation.findOne', config: { policies: [] } },
  { method: 'POST', path: '/conversations', handler: 'conversation.create', config: { policies: [] } },
  { method: 'PUT', path: '/conversations/:id', handler: 'conversation.update', config: { policies: [] } },
  { method: 'DELETE', path: '/conversations/:id', handler: 'conversation.delete', config: { policies: [] } },

  // Memories. Same scoping story as conversations: every handler keys off the
  // admin session, and rows addressed by id are re-checked against their
  // owner. There is no route to another user's memories to forget to protect.
  { method: 'GET', path: '/memories', handler: 'memory.find', config: { policies: [] } },
  { method: 'POST', path: '/memories', handler: 'memory.create', config: { policies: [] } },
  { method: 'PUT', path: '/memories/:id', handler: 'memory.update', config: { policies: [] } },
  { method: 'DELETE', path: '/memories/:id', handler: 'memory.delete', config: { policies: [] } },

  // What tools the chat can reach, and where each comes from. Read-only.
  { method: 'GET', path: '/tool-sources', handler: 'tool-sources.find', config: { policies: [] } },

  // Research notes. Same per-user scoping again.
  { method: 'GET', path: '/notes', handler: 'note.find', config: { policies: [] } },
  { method: 'POST', path: '/notes', handler: 'note.create', config: { policies: [] } },
  { method: 'PUT', path: '/notes/:id', handler: 'note.update', config: { policies: [] } },
  { method: 'DELETE', path: '/notes/:id', handler: 'note.delete', config: { policies: [] } },
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
    return enabled ? [configRoute, ...chatRoutes] : [configRoute];
  },
};
