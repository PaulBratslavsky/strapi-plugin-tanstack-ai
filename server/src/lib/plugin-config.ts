import type { Core } from '@strapi/strapi';
import type { PluginConfig } from '../config';

/**
 * The one place plugin config is read.
 *
 * Strapi returns whatever the host wrote merged over our defaults, typed as
 * `unknown`. Funnelling it through here means the shape is asserted once
 * rather than re-guessed at every call site — and it is the single line to
 * change if the config key ever moves.
 */
export function readConfig(strapi: Core.Strapi): PluginConfig {
  return strapi.config.get('plugin::tanstack-ai') as PluginConfig;
}
