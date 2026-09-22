import { getTranslation } from './utils/getTranslation';
import { PLUGIN_ID } from './pluginId';
import { Initializer } from './components/Initializer';
import { PluginIcon } from './components/PluginIcon';

import type { StrapiApp } from '@strapi/strapi/admin';

const plugin: StrapiApp['appPlugins'][string] = {
  /**
   * SYNCHRONOUS, and it must stay that way.
   *
   * Strapi calls each plugin's `register()` without awaiting it and builds its
   * router shortly after. Through 1.2.1 this awaited a config fetch before
   * `addMenuLink`, so whenever that request was slower than the router (it
   * often was on Strapi Cloud) the sidebar got the icon but the route was
   * never registered: "Page not found". Whether chat can run is now decided on
   * the chat page, which asks the server and shows a setup notice if not.
   */
  register(app) {
    app.registerPlugin({
      id: PLUGIN_ID,
      initializer: Initializer,
      isReady: false,
      name: PLUGIN_ID,
    });

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
