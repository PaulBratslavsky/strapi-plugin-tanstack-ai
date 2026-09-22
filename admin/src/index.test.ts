import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Strapi's admin calls each plugin's `register()` WITHOUT awaiting it
 * (@strapi/admin StrapiApp.register: `this.appPlugins[plugin].register(this)`)
 * and builds its router shortly after. A menu link added after an `await`
 * therefore races the router: when the await loses, the sidebar shows the
 * icon but the route was never registered, and the page is "Page not found".
 * That shipped in 1.2.1 and showed up on Strapi Cloud, where the config
 * request is slower than on localhost.
 */
describe('admin register()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds the menu link synchronously, before any network call can resolve', async () => {
    // A fetch that never answers: anything gated on it can never run.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    vi.stubGlobal('window', { strapi: { backendURL: 'http://localhost:1337' } });

    const { default: plugin } = await import('./index');
    const app = { registerPlugin: vi.fn(), addMenuLink: vi.fn() };

    // Deliberately not awaited, exactly as Strapi calls it.
    void plugin.register!(app as never);

    expect(app.registerPlugin).toHaveBeenCalledTimes(1);
    expect(app.addMenuLink).toHaveBeenCalledTimes(1);
    expect(app.addMenuLink.mock.calls[0][0]).toMatchObject({ to: 'plugins/tanstack-ai' });
  });
});
