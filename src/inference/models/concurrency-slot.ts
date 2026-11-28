import type { ApiKeyPrincipal } from '@/api-keys/models/api-key';
import type { Snapshot } from '@/snapshot/models/snapshot';
import type { WaitingRequester } from '@/inference/schemas/waiting-request.schema';
import { ClientCancelledError } from './attempt-failure';
import { GatewayError } from './gateway-error';
import type { AttemptTarget } from './route-selection';
import type { UsageMeter } from './usage-meter';

export type SlotHolderKind = 'api-key' | 'provider-account';

export interface SlotHolder {
  kind: SlotHolderKind;
  id: string;
  currentLimit(): number | null;
}

export type SlotHolderRef = Pick<SlotHolder, 'kind' | 'id'>;

export interface HeldSlot {
  release(): void;
}

export const UNCOUNTED_SLOT: HeldSlot = { release: () => undefined };

export class SlotWaitAbandonedError extends ClientCancelledError {
  constructor() {
    super();
    this.name = 'SlotWaitAbandonedError';
  }
}

export class SlotWait {
  private readonly receivedMs = performance.now();
  private deadlineMs: number | null = null;

  constructor(
    readonly clientSignal: AbortSignal,
    private readonly meter: UsageMeter,
  ) {}

  async deadline(readBudgetMs: () => Promise<number>): Promise<number> {
    this.deadlineMs ??= this.receivedMs + (await readBudgetMs());
    return this.deadlineMs;
  }

  requester(): WaitingRequester {
    return this.meter.waitingRequester();
  }

  waited(durationMs: number): void {
    this.meter.slotWaited(durationMs);
  }
}

export function apiKeySlotHolder(
  principal: ApiKeyPrincipal,
  currentSnapshot: () => Snapshot,
): SlotHolder {
  return {
    kind: 'api-key',
    id: principal.apiKeyId,
    currentLimit: () => {
      for (const apiKey of currentSnapshot().apiKeysByKeyId.values()) {
        if (apiKey.id === principal.apiKeyId) {
          return apiKey.concurrencyLimit;
        }
      }
      return principal.concurrencyLimit;
    },
  };
}

export function providerAccountSlotHolder(
  { upstreamModel, providerAccount }: AttemptTarget,
  currentSnapshot: () => Snapshot,
): SlotHolder {
  return {
    kind: 'provider-account',
    id: providerAccount.id,
    currentLimit: () => {
      const current = currentSnapshot()
        .upstreamModelsById.get(upstreamModel.id)
        ?.provider.providerAccounts.find((account) => account.id === providerAccount.id);
      return (current ?? providerAccount).concurrencyLimit;
    },
  };
}

export function slotWaitExceededError(kind: SlotHolderKind): GatewayError {
  if (kind === 'api-key') {
    return new GatewayError(
      'concurrency_wait_exceeded',
      'This API Key had as many requests in flight as its Concurrency Limit allows for longer than the gateway waits',
      'client',
    );
  }
  return new GatewayError(
    'concurrency_wait_exceeded',
    'Every Provider Account that could serve this request was at its Concurrency Limit for longer than the gateway waits',
    'gateway',
  );
}
