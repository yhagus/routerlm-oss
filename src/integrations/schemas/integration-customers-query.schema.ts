import { z } from 'zod';
import { searchTextSchema } from '@/usage/schemas/usage.schema';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

export const integrationCustomersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: searchTextSchema.optional(),
});
export type IntegrationCustomersQuery = z.infer<typeof integrationCustomersQuerySchema>;
