import { holderKeyOf } from '@/inference/models/concurrency-keys';
import type { SlotHolderRef } from '@/inference/models/concurrency-slot';
import type { WaitingCaller, WaitsFor } from '@/inference/schemas/waiting-request.schema';
import type { DescribedWaiter, HolderLine } from '@/waiting-requests/providers/waiting-lines';
import type {
  WaitingHolder,
  WaitingLine,
  WaitingRequest,
  WaitingRequestCaller,
} from './waiting-requests';

export interface NamedApiKey {
  name: string;
  concurrencyLimit: number | null;
}

export interface NamedProviderAccount {
  name: string;
  providerName: string;
  concurrencyLimit: number | null;
}

export interface WaitingDirectory {
  apiKeys: Map<string, NamedApiKey>;
  providerAccounts: Map<string, NamedProviderAccount>;
  integrationNames: Map<string, string>;
  userEmails: Map<string, string>;
}

export function holdersWaitedFor(waitsFor: WaitsFor): SlotHolderRef[] {
  if (waitsFor.kind === 'api-key') {
    return [{ kind: 'api-key', id: waitsFor.apiKeyId }];
  }
  return waitsFor.providerAccountIds.map((id) => ({ kind: 'provider-account', id }));
}

export function distinctHoldersOf(waiters: DescribedWaiter[]): SlotHolderRef[] {
  const holdersByKey = new Map<string, SlotHolderRef>();
  for (const { descriptor } of waiters) {
    for (const holder of holdersWaitedFor(descriptor.waitsFor)) {
      holdersByKey.set(holderKeyOf(holder), holder);
    }
  }
  return [...holdersByKey.values()];
}

export function waitingLinesOf(
  holders: SlotHolderRef[],
  lines: Map<string, HolderLine>,
  directory: WaitingDirectory,
): WaitingLine[] {
  const waitingLines: WaitingLine[] = [];
  for (const holder of holders) {
    const line = lines.get(holderKeyOf(holder));
    if (!line || line.ticketsInOrder.length === 0) {
      continue;
    }
    waitingLines.push({
      holder: waitingHolderOf(holder, directory),
      limit: limitOf(holder, directory),
      running: line.running,
      waiting: line.ticketsInOrder.length,
    });
  }
  return waitingLines;
}

export function waitingRequestsOf(
  waiters: DescribedWaiter[],
  lines: Map<string, HolderLine>,
  directory: WaitingDirectory,
  nowMs: number,
): WaitingRequest[] {
  const requests: WaitingRequest[] = [];
  for (const { ticket, descriptor } of waiters) {
    const holders = holdersWaitedFor(descriptor.waitsFor);
    const places = placesOf(ticket, holders, lines);
    const [best] = places;
    if (!best) {
      continue;
    }
    requests.push({
      id: ticket,
      waitingSince: descriptor.waitingSince,
      deadline: descriptor.deadline,
      waitedMs: Math.max(nowMs - Date.parse(descriptor.waitingSince), 0),
      msUntilRefused: Math.max(Date.parse(descriptor.deadline) - nowMs, 0),
      waitsFor: descriptor.waitsFor,
      caller: namedCallerOf(descriptor.caller, directory),
      requestedModelName: descriptor.requestedModelName,
      isStreamed: descriptor.isStreamed,
      clientIp: descriptor.clientIp,
      userAgent: descriptor.userAgent,
      bestPlace: { place: best.place, holder: waitingHolderOf(best.holder, directory) },
      otherHolders: holders
        .filter((holder) => holder !== best.holder)
        .map((holder) => waitingHolderOf(holder, directory)),
    });
  }
  return requests.sort(
    (left, right) => Date.parse(left.waitingSince) - Date.parse(right.waitingSince),
  );
}

interface HolderPlace {
  place: number;
  holder: SlotHolderRef;
}

function placesOf(
  ticket: string,
  holders: SlotHolderRef[],
  lines: Map<string, HolderLine>,
): HolderPlace[] {
  const places: HolderPlace[] = [];
  for (const holder of holders) {
    const index = lines.get(holderKeyOf(holder))?.ticketsInOrder.indexOf(ticket) ?? -1;
    if (index >= 0) {
      places.push({ place: index + 1, holder });
    }
  }
  return places.sort((left, right) => left.place - right.place);
}

function waitingHolderOf(holder: SlotHolderRef, directory: WaitingDirectory): WaitingHolder {
  if (holder.kind === 'api-key') {
    return {
      kind: 'api-key',
      id: holder.id,
      apiKeyName: directory.apiKeys.get(holder.id)?.name ?? null,
    };
  }
  const account = directory.providerAccounts.get(holder.id);
  return {
    kind: 'provider-account',
    id: holder.id,
    providerName: account?.providerName ?? null,
    providerAccountName: account?.name ?? null,
  };
}

function limitOf(holder: SlotHolderRef, directory: WaitingDirectory): number | null {
  if (holder.kind === 'api-key') {
    return directory.apiKeys.get(holder.id)?.concurrencyLimit ?? null;
  }
  return directory.providerAccounts.get(holder.id)?.concurrencyLimit ?? null;
}

function namedCallerOf(caller: WaitingCaller, directory: WaitingDirectory): WaitingRequestCaller {
  switch (caller.kind) {
    case 'api-key':
      return {
        kind: 'api-key',
        apiKeyId: caller.apiKeyId,
        apiKeyName: directory.apiKeys.get(caller.apiKeyId)?.name ?? null,
        customer: caller.customer
          ? {
              integrationId: caller.customer.integrationId,
              integrationName:
                directory.integrationNames.get(caller.customer.integrationId) ?? null,
              customerId: caller.customer.customerId,
            }
          : null,
      };
    case 'playground':
      return {
        kind: 'playground',
        userId: caller.userId,
        userEmail: directory.userEmails.get(caller.userId) ?? null,
      };
    case 'unidentified':
      return { kind: 'unidentified' };
  }
}
