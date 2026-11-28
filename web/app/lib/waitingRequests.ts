import { formatCount } from '~/lib/usage';

export type WaitingHolder =
  | { kind: 'api-key'; id: string; apiKeyName: string | null }
  | {
      kind: 'provider-account';
      id: string;
      providerName: string | null;
      providerAccountName: string | null;
    };

export interface WaitingLine {
  holder: WaitingHolder;
  limit: number | null;
  running: number;
  waiting: number;
}

export type WaitingRequestCaller =
  | {
      kind: 'api-key';
      apiKeyId: string;
      apiKeyName: string | null;
      customer: {
        integrationId: string;
        integrationName: string | null;
        customerId: string;
      } | null;
    }
  | { kind: 'playground'; userId: string; userEmail: string | null }
  | { kind: 'unidentified' };

export type WaitsFor =
  | { kind: 'api-key'; apiKeyId: string }
  | { kind: 'provider-accounts'; providerAccountIds: string[] };

export interface PlaceInLine {
  place: number;
  holder: WaitingHolder;
}

export interface WaitingRequest {
  id: string;
  waitingSince: string;
  deadline: string;
  waitedMs: number;
  msUntilRefused: number;
  waitsFor: WaitsFor;
  caller: WaitingRequestCaller;
  requestedModelName: string | null;
  isStreamed: boolean;
  clientIp: string | null;
  userAgent: string | null;
  bestPlace: PlaceInLine;
  otherHolders: WaitingHolder[];
}

export interface WaitingRequestList {
  available: boolean;
  lines: WaitingLine[];
  requests: WaitingRequest[];
}

export interface WaitingRequestCount {
  available: boolean;
  count: number;
}

export const DELETED_API_KEY = 'Deleted API Key';

export function apiKeyNameOf(name: string | null): string {
  return name ?? DELETED_API_KEY;
}

export function holderLabel(holder: WaitingHolder): string {
  if (holder.kind === 'api-key') return `API Key ${apiKeyNameOf(holder.apiKeyName)}`;
  if (holder.providerAccountName === null) return 'Deleted Provider Account';
  return `${holder.providerName ?? 'Deleted Provider'} · ${holder.providerAccountName}`;
}

export function playgroundCallerLabel(userEmail: string | null): string {
  return `Playground · ${userEmail ?? 'deleted user'}`;
}

export function customerLabel(customer: {
  integrationName: string | null;
  customerId: string;
}): string {
  return `${customer.integrationName ?? 'Deleted Integration'} · ${customer.customerId}`;
}

export function callerSearchText(caller: WaitingRequestCaller): string {
  if (caller.kind === 'playground') return playgroundCallerLabel(caller.userEmail);
  if (caller.kind === 'unidentified') return 'Unidentified';
  const apiKeyName = apiKeyNameOf(caller.apiKeyName);
  return caller.customer ? `${apiKeyName} ${customerLabel(caller.customer)}` : apiKeyName;
}

export function holderLink(holder: WaitingHolder): string | undefined {
  if (holder.kind === 'api-key') {
    return holder.apiKeyName === null ? undefined : apiKeyLink(holder.apiKeyName);
  }
  return holder.providerName === null ? undefined : providerLink(holder.providerName);
}

export function apiKeyLink(apiKeyName: string): string {
  return `/api-keys?q=${encodeURIComponent(apiKeyName)}`;
}

function providerLink(providerName: string): string {
  return `/providers?q=${encodeURIComponent(providerName)}`;
}

export function lineOccupancyLabel(line: WaitingLine): string {
  const running =
    line.limit === null
      ? `${formatCount(line.running)} running`
      : `${formatCount(line.running)} of ${formatCount(line.limit)} running`;
  return `${running}, ${formatCount(line.waiting)} waiting`;
}

const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' });
const ORDINAL_SUFFIXES: Record<Intl.LDMLPluralRule, string> = {
  zero: 'th',
  one: 'st',
  two: 'nd',
  few: 'rd',
  many: 'th',
  other: 'th',
};

export function ordinal(place: number): string {
  return `${place}${ORDINAL_SUFFIXES[ordinalRules.select(place)]}`;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export function formatWaitDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0');
  return `${minutes} m ${seconds} s`;
}
