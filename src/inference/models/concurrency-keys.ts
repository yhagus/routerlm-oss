import type { SlotHolderRef } from './concurrency-slot';

export const CONCURRENCY_KEY_PREFIX = 'routerlm:concurrency:';
export const TICKET_SEQUENCE_KEY = `${CONCURRENCY_KEY_PREFIX}ticket-sequence`;
export const WAITING_REQUESTS_KEY = `${CONCURRENCY_KEY_PREFIX}waiting-requests`;
export const WAITING_REQUEST_LEASES_KEY = `${CONCURRENCY_KEY_PREFIX}waiting-request-leases`;

export interface SlotKeys {
  held: string;
  line: string;
  lineLeases: string;
}

export function holderKeyOf({ kind, id }: SlotHolderRef): string {
  return `${kind}:${id}`;
}

export function slotKeysOf(holder: SlotHolderRef): SlotKeys {
  const prefix = CONCURRENCY_KEY_PREFIX + holderKeyOf(holder);
  return { held: `${prefix}:held`, line: `${prefix}:line`, lineLeases: `${prefix}:line-leases` };
}
