export const PING_QUEUE = 'ping';

export const USAGE_QUEUE = 'usage';

export const ERROR_CAPTURES_QUEUE = 'error-captures';

export const QUOTA_METERS_QUEUE = 'quota-meters';

export const PLANS_QUEUE = 'plans';

export const OAUTH_SIGN_INS_QUEUE = 'oauth-sign-ins';

export const QUEUE_NAMES = [
  PING_QUEUE,
  USAGE_QUEUE,
  ERROR_CAPTURES_QUEUE,
  QUOTA_METERS_QUEUE,
  PLANS_QUEUE,
] as const;
