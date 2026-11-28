export const ERROR_ORIGINS = ['client', 'upstream', 'gateway'] as const;
export type ErrorOrigin = (typeof ERROR_ORIGINS)[number];

export const ERROR_ORIGIN_LABELS: Record<ErrorOrigin, string> = {
  client: 'Client',
  upstream: 'Upstream',
  gateway: 'Gateway',
};
