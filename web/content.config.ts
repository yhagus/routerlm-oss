import { defineCollection, defineContentConfig, z } from '@nuxt/content';

const docsPageSchema = z.object({
  endpoint: z.string().optional(),
  rawbody: z.string(),
});

export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: { include: 'docs/*.md', prefix: '/docs' },
      schema: docsPageSchema,
    }),
    docs_id: defineCollection({
      type: 'page',
      source: { include: 'docs-id/*.md', prefix: '/id/docs' },
      schema: docsPageSchema,
    }),
  },
});
