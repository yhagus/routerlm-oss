import { defineCollection, defineContentConfig } from "@nuxt/content";

export default defineContentConfig({
  collections: {
    // The public client documentation, served at /docs. The backend's
    // tests/docs/client-examples.test.ts runs every example in these pages.
    docs: defineCollection({ type: "page", source: "docs/**/*.md" }),
  },
});
