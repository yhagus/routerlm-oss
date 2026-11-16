import { defineCollection, defineContentConfig, z } from "@nuxt/content";

const docsPageSchema = z.object({
  /** The method and path a page documents, shown in its title block: `POST /v1/messages`. */
  endpoint: z.string().optional(),
  /** The page's Markdown source, for the "Copy page" button. */
  rawbody: z.string(),
});

export default defineContentConfig({
  collections: {
    // The public client documentation in English, served at /docs. The backend's
    // tests/docs/client-examples.test.ts runs every example in these pages.
    // The pages are flat files, so this glob leaves docs-id/ out.
    docs: defineCollection({
      type: "page",
      source: { include: "docs/*.md", prefix: "/docs" },
      schema: docsPageSchema,
    }),
    // The same documentation in Indonesian, served at /id/docs
    // (docs-id/1.authentication.md becomes /id/docs/authentication).
    docs_id: defineCollection({
      type: "page",
      source: { include: "docs-id/*.md", prefix: "/id/docs" },
      schema: docsPageSchema,
    }),
  },
});
