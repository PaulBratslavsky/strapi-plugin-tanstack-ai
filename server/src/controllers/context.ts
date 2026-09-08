import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { readConfig } from '../lib/plugin-config';
import { estimateTokens, measureTools, safeDetect, warnAboutBudget } from '../lib/context-budget';
import { buildPreamble } from '../services/chat';

/**
 * What the conversation costs before the user types, and which model answers.
 *
 * Ported from the reference plugin's `getContextInfo` / `getModelInfo`.
 *
 * MEASURED FOR THE CALLING ADMIN, not in general — the tool set is filtered by
 * their role and their source toggles, so two admins on one install face
 * different preambles, and the one with more tools is the one closer to the
 * edge. A general figure would describe neither.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async info(ctx: Context) {
    const config = readConfig(strapi);

    const { system, tools } = await buildPreamble(strapi, {
      ...(typeof ctx.state?.user?.id === 'number' ? { adminUserId: ctx.state.user.id } : {}),
      ...(ctx.state?.userAbility ? { ability: ctx.state.userAbility } : {}),
    });

    const toolMeasure = measureTools(tools as unknown[]);
    const systemTokens = estimateTokens(system ?? '');
    const preambleTokens = systemTokens + toolMeasure.tokens;

    const detected = await safeDetect(strapi, config);

    ctx.body = {
      data: {
        systemTokens,
        toolTokens: toolMeasure.tokens,
        toolCount: toolMeasure.count,
        preambleTokens,
        contextWindow: detected.window,
        windowSource: detected.source,
        trainedContext: detected.trained,
        warning: warnAboutBudget(preambleTokens, detected.window),
        // Never presented as exact. A real tokeniser differs per model and
        // would have to ship per provider; four characters per token is the
        // usual approximation, and saying so is the difference between a
        // useful gauge and a number someone plans around.
        estimated: true,
      },
    };
  },

  /**
   * Which model is answering, and whether inference leaves the building.
   *
   * `isLocal` is computed from the host, not claimed: "local" means the
   * baseURL points at a loopback or private address, which is the only form
   * of the claim that can be checked.
   */
  async model(ctx: Context) {
    const config = readConfig(strapi);
    const baseURL = config.chat.baseURL ?? null;

    let isLocal = false;
    if (baseURL) {
      try {
        const host = new URL(baseURL).hostname;
        isLocal =
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '::1' ||
          host === 'host.docker.internal' ||
          host.endsWith('.local') ||
          /^10\./.test(host) ||
          /^192\.168\./.test(host) ||
          /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
      } catch {
        isLocal = false;
      }
    }

    ctx.body = {
      data: { provider: config.chat.provider, model: config.chat.model, baseURL, isLocal },
    };
  },
});
