import { getTranslation } from './utils/getTranslation';
import { PLUGIN_ID } from './pluginId';
import { backendURL } from './utils/auth';
import { Initializer } from './components/Initializer';
import { PluginIcon } from './components/PluginIcon';

import type { StrapiApp } from '@strapi/strapi/admin';

/**
 * Ask the server whether chat is on.
 *
 * Runs during `register()`, i.e. before anyone has logged in — which is why
 * the endpoint it calls is unauthenticated and returns a single boolean.
 *
 * Fails CLOSED. If the server cannot be reached, or the plugin's server half
 * is not installed, no menu link appears. A link that leads to an error page
 * is worse than no link: it advertises a feature the install does not have.
 */
async function chatEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${backendURL()}/${PLUGIN_ID}/config`);
    if (!res.ok) return false;
    const body = (await res.json()) as { chat?: { enabled?: boolean } };
    return body.chat?.enabled === true;
  } catch {
    return false;
  }
}

const plugin: StrapiApp['appPlugins'][string] = {
  async register(app) {
    // The plugin itself always registers: its MCP tools live on the server and
    // do not need an admin surface. Only the CHAT UI is conditional.
    app.registerPlugin({
      id: PLUGIN_ID,
      initializer: Initializer,
      isReady: false,
      name: PLUGIN_ID,
    });

    if (!(await chatEnabled())) {
      // No menu link, no route, no lazy chunk fetched. With chat off the admin
      // ships nothing for it — which is the promise in the plugin's config
      // surface, not just a nicety.
      return;
    }

    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: PluginIcon,
      intlLabel: {
        id: `${PLUGIN_ID}.plugin.name`,
        defaultMessage: 'TanStack AI',
      },
      Component: () => import('./pages/App'),
      permissions: [],
    });
  },

  registerTrads({ locales }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = (await import(`./translations/${locale}.json`)) as {
            default: Record<string, string>;
          };

          const newData: Record<string, string> = {};
          for (const [key, value] of Object.entries(data)) {
            newData[getTranslation(key)] = value;
          }

          return { data: newData, locale };
        } catch {
          return { data: {}, locale };
        }
      }),
    );
  },
};

export default plugin;
