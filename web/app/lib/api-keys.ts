import { type AllowedModelGroup, allowedGroupName } from '~/lib/modelGroups';
import { formatCost, formatCount } from '~/lib/usage';

export const MAX_SPEND_LIMIT_USD = 99_999_999;

export const MAX_REQUEST_RATE = 2_147_483_647;

export interface ModelChoice {
  id: string;
  name: string;
  displayName: string | null;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyId: string;
  createdBy: { id: string; email: string } | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  allowedModels: { id: string; name: string | null }[];
  allowedModelGroups: AllowedModelGroup[];
  directUpstreamAccess: boolean;
  isCopyable: boolean;
  lastRotatedAt: string | null;
  integration: { id: string; name: string } | null;
  customerId: string | null;
  spendLimit: number | null;
  spent: number;
  requestRate: number | null;
  concurrencyLimit: number | null;
}

export interface AllowedAccess {
  allowedModels: { id: string; name: string | null }[];
  allowedModelGroups: AllowedModelGroup[];
}

export function allowedAccessLabel(access: AllowedAccess): string {
  const models = access.allowedModels.map((model) => model.name ?? 'Deleted Model');
  const groups = access.allowedModelGroups.map((group) => `${allowedGroupName(group)} (Group)`);
  const names = [...models, ...groups];
  return names.length === 0 ? 'All Models' : names.join(', ');
}

export function pickedLabels(
  ids: string[],
  options: { label: string; value: string }[],
  fallback: string,
): string[] {
  const labels = new Map(options.map((option) => [option.value, option.label]));
  return ids.map((id) => labels.get(id) ?? fallback);
}

export interface ApiKeyRotation {
  id: string;
  rotatedAt: string;
  rotatedBy: { id: string; email: string } | null;
  previousKeyId: string;
  newKeyId: string;
}

export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

export function isIntegrationOwned(apiKey: ApiKeySummary): boolean {
  return apiKey.integration !== null;
}

export type ApiKeyStatus = 'active' | 'expired' | 'revoked';

export const API_KEY_STATUS_LABELS = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
} as const satisfies Record<ApiKeyStatus, string>;

export function apiKeyStatus(apiKey: ApiKeySummary, now: number): ApiKeyStatus {
  if (apiKey.revokedAt) return 'revoked';
  if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= now) return 'expired';
  return 'active';
}

export function endOfLocalDay(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

export function localDateOf(expiresAt: string | null): string {
  return expiresAt ? new Date(expiresAt).toLocaleDateString('en-CA') : '';
}

export function spendLimitLabel(apiKey: ApiKeySummary): string {
  const limit = apiKey.spendLimit === null ? 'no limit' : formatCost(apiKey.spendLimit);
  return `${formatCost(apiKey.spent)} of ${limit}`;
}

export function requestRateLabel(apiKey: ApiKeySummary): string {
  return apiKey.requestRate === null ? 'No limit' : `${formatCount(apiKey.requestRate)} / min`;
}

export const API_KEY_CONFIRM_COPY = {
  rotate: {
    title: 'Rotate API Key',
    description: (name: string) =>
      `${name} gets a new key, and clients still using the current one are refused at once. Its name, expiry, allowed Models and usage history stay.`,
    action: 'Rotate key',
    failed: "Couldn't rotate the API Key.",
  },
  revoke: {
    title: 'Revoke API Key',
    description: (name: string) =>
      `Clients using ${name} are refused from now on. This can't be undone.`,
    action: 'Revoke API Key',
    failed: "Couldn't revoke the API Key.",
  },
} as const;
