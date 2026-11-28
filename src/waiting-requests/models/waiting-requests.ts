import type { WaitsFor } from '@/inference/schemas/waiting-request.schema';

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
