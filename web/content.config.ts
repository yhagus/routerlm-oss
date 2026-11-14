import { defineCollection, defineContentConfig } from "@nuxt/content";

export default defineContentConfig({
  collections: {
    // The public client documentation, served at /docs. The backend's
    // test/docs-examples.e2e-spec.ts runs every example in these pages.
    docs: defineCollection({ type: "page", source: "docs/**/*.md" }),
  },
});
