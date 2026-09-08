import type { Core } from "@strapi/strapi";

const service = (_context: { strapi: Core.Strapi }) => ({
  getWelcomeMessage() {
    return "Welcome to Strapi 🚀";
  },
});

export default service;