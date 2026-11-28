import { formatCount } from '~/lib/usage';

export const MAX_CONCURRENCY_LIMIT = 2_147_483_647;

export function concurrencyLimitLabel(limit: number | null): string {
  return limit === null ? 'No limit' : `${formatCount(limit)} at once`;
}
