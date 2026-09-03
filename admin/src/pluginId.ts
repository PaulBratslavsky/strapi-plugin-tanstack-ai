/**
 * MUST match `strapi.name` in package.json.
 *
 * This is the id the server registers routes under (`/tanstack-ai/...`) AND
 * the id the admin uses to call them. The generator seeds it from the PACKAGE
 * name, which is `strapi-plugin-tanstack-ai` — so changing `strapi.name` to
 * the shorter form without changing this leaves the panel fetching a path the
 * server never registered. That is a 404 the admin reports as "could not read
 * plugin config", which reads like a broken plugin rather than a typo.
 */
export const PLUGIN_ID = "tanstack-ai";
