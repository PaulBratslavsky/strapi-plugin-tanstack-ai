import { describe, expect, it } from 'vitest';
import { z } from '@strapi/utils';
import { ALL_TOOLS, prepareTool, toolNames } from './index';
import { actionDefinitionForTool, actionForTool } from '../lib/tool-permissions';

/**
 * Strapi's own admin action uid rule, from
 * node_modules/@strapi/admin/dist/server/server/src/validation/action-provider.js
 * — lowercase letters, dots and hyphens, and it must END on a letter.
 *
 * Copied rather than imported: the validator lives behind a deep path into
 * Strapi's dist internals, and a test that breaks when Strapi reshuffles its
 * build is a false alarm, not a finding.
 */
const STRAPI_ACTION_UID = /^[a-z]([a-z|.|-]+)[a-z]$/;

/** Stand-in for the MCP handler context the schema resolvers are handed. */
const HANDLER_CONTEXT = {} as never;

/**
 * The structural test.
 *
 * It exists for one failure: a tool added to the registry whose permission
 * action nobody registers. That tool registers fine, reports success, and is
 * then absent from `tools/list` — with no error on either side. This plugin
 * has already lost a dozen turns to that exact shape once.
 *
 * Every assertion below is over the registry itself, so a third tool is
 * covered the moment it is added rather than when someone remembers to write
 * a test for it.
 */
describe.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))('%s', (name, tool) => {
  it('describes itself well enough for a model to choose it', () => {
    // The description IS the tool's interface to the model. A thin one gets
    // the tool ignored in favour of a built-in that answers a narrower
    // question badly.
    expect(tool.description.length).toBeGreaterThan(80);
  });

  it('has a title for human-facing clients', () => {
    expect(tool.title).toBeTruthy();
  });

  it('takes a ZodObject as input', () => {
    // The resolvers receive the MCP handler context; neither tool reads it,
    // but the signature is part of the contract, so pass one.
    expect(tool.resolveInputSchema?.(HANDLER_CONTEXT)).toBeInstanceOf(z.ZodObject);
  });

  it('declares a ZodObject output schema', () => {
    // Without one the model gets prose it has to parse; with one it gets data.
    expect(tool.resolveOutputSchema(HANDLER_CONTEXT)).toBeInstanceOf(z.ZodObject);
  });

  it('is gated behind an action this plugin actually registers', () => {
    // THE ONE THAT MATTERS, and it has to cross the two INDEPENDENT
    // implementations to mean anything. `register.ts` registers what
    // `actionDefinitionForTool` returns; each tool's policy names what
    // `actionForTool` returns. Comparing the policy against `actionForTool`
    // would compare the function with itself and pass no matter what — the
    // first version of this test did exactly that, and a deliberate mutation
    // sailed through it. Rebuilding the id from the DEFINITION is what makes
    // the assertion able to fail.
    const definition = actionDefinitionForTool(name);
    const registered = `plugin::${definition.pluginName}.${definition.uid}`;
    const actions = (tool.auth?.policies ?? []).map((policy) => policy.action);
    expect(actions).toContain(registered);
  });

  it('has an action uid Strapi will accept', () => {
    // An invalid uid is rejected at registration, so the action never exists,
    // so the tool never appears — with the failure three steps from the cause.
    // Underscores are the trap: the MCP tool name uses them and the uid cannot.
    expect(actionDefinitionForTool(name).uid).toMatch(STRAPI_ACTION_UID);
  });

  it('is gated by auth rather than dev-mode', () => {
    // `devModeOnly` tools do not exist in production. Shipping one is a tool
    // that works on the author's laptop and nowhere else.
    expect(tool.auth?.policies?.length ?? 0).toBeGreaterThan(0);
  });

  it('names a subject-less action', () => {
    // A subject-scoped grant fails the subject-less capability check Strapi
    // runs per session — the original bug, kept out with a test.
    for (const policy of tool.auth?.policies ?? []) {
      expect(policy).not.toHaveProperty('subject');
    }
  });
});

describe('the registry itself', () => {
  it('has no duplicate names', () => {
    // registerTool throws synchronously on a conflict, taking out boot.
    expect(new Set(toolNames()).size).toBe(toolNames().length);
  });

  it('exposes bare snake_case names, matching Strapi built-in convention', () => {
    for (const name of toolNames()) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

describe('prepareTool', () => {
  const config = { toolPrefix: '', sizeLimitBytes: 950_000 };

  it('leaves the name alone when no prefix is configured', () => {
    expect(prepareTool(ALL_TOOLS[0], config).name).toBe(ALL_TOOLS[0].name);
  });

  it('applies a configured prefix to the MCP-visible name', () => {
    // The key was documented, validated and ignored before this existed: an
    // operator setting a prefix to dodge a collision got no prefix, silently.
    expect(prepareTool(ALL_TOOLS[0], { ...config, toolPrefix: 'acme' }).name).toBe(
      `acme_${ALL_TOOLS[0].name}`,
    );
  });

  it('ignores a whitespace-only prefix rather than emitting a leading underscore', () => {
    expect(prepareTool(ALL_TOOLS[0], { ...config, toolPrefix: '  ' }).name).toBe(ALL_TOOLS[0].name);
  });

  it('does NOT move the permission action when the prefix changes', () => {
    // Deliberate. An action id keyed to the prefixed name would orphan every
    // existing grant the moment an operator set a prefix: the tool vanishes
    // from tools/list, and the checkbox that used to enable it stays ticked.
    const prefixed = prepareTool(ALL_TOOLS[0], { ...config, toolPrefix: 'acme' });
    const actions = (prefixed.auth?.policies ?? []).map((policy: { action: string }) => policy.action);
    expect(actions).toContain(actionForTool(ALL_TOOLS[0].name));
  });
});
