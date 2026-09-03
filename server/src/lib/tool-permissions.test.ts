import { describe, expect, it } from 'vitest';
import { actionDefinitionForTool, actionForTool, displayNameForTool } from './tool-permissions';

describe('actionForTool', () => {
  it('replaces underscores with hyphens', () => {
    // Strapi's admin action uid validator accepts lowercase letters, dots and
    // hyphens — an underscore is rejected at registration, and a tool whose
    // action never registers is a tool that never appears in tools/list.
    expect(actionForTool('list_content_types')).toBe('plugin::tanstack-ai.tool.list-content-types');
  });

  it('namespaces under the plugin, so the action cannot collide', () => {
    expect(actionForTool('search_content')).toMatch(/^plugin::tanstack-ai\./);
  });

  it('carries no subject', () => {
    // The reason the first attempt failed: Strapi enables an MCP capability
    // with `subject !== undefined ? ability.can(action, subject) : ability.can(action)`.
    // A borrowed content-manager action is always subject-scoped, so the
    // subject-less check fails and the tool silently never appears.
    expect(actionForTool('search_content')).not.toMatch(/api::/);
  });
});

describe('actionDefinitionForTool', () => {
  it('produces a uid the action id can be rebuilt from', () => {
    // These two must agree. The definition is what gets registered; the action
    // id is what the tool's policy names. If they drift, registration succeeds
    // and the tool is invisible.
    const definition = actionDefinitionForTool('search_content');
    expect(`plugin::${definition.pluginName}.${definition.uid}`).toBe(actionForTool('search_content'));
  });

  it('files the action under plugins, so it appears in the admin grid', () => {
    expect(actionDefinitionForTool('search_content').section).toBe('plugins');
  });
});

describe('displayNameForTool', () => {
  it('reads as a label, not an identifier', () => {
    expect(displayNameForTool('list_content_types')).toBe('List content types');
  });
});
