import { Injectable } from '@nestjs/common';
import { InjectThrottlerStorage, minutes, type ThrottlerStorage } from '@nestjs/throttler';
import type { ApiKeyPrincipal } from '@/api-keys/models/api-key';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { SpendLimitFlags } from '@/spend-limits/providers/spend-limit-flags';
import {
  apiKeySlotHolder,
  type HeldSlot,
  type SlotWait,
  UNCOUNTED_SLOT,
} from '@/inference/models/concurrency-slot';
import { GatewayError } from '@/inference/models/gateway-error';
import type { InferenceCaller } from '@/inference/models/inference';
import { ConcurrencySlots } from './concurrency-slots';

const REQUEST_RATE_THROTTLER = 'request-rate';
const REQUEST_RATE_WINDOW = minutes(1);
const NO_BLOCK = 0;

@Injectable()
export class CallerLimits {
  constructor(
    private readonly spendLimitFlags: SpendLimitFlags,
    @InjectThrottlerStorage() private readonly throttlerStorage: ThrottlerStorage,
    private readonly slots: ConcurrencySlots,
    private readonly snapshot: SnapshotService,
  ) {}

  async waitForSlot(caller: InferenceCaller, wait: SlotWait): Promise<HeldSlot> {
    if (caller.kind !== 'api-key' || caller.principal.concurrencyLimit === null) {
      return UNCOUNTED_SLOT;
    }
    const holder = apiKeySlotHolder(caller.principal, () => this.snapshot.current);
    const { slot } = await this.slots.takeFirstFree([holder], wait);
    return slot;
  }

  async assertWithinLimits(caller: InferenceCaller): Promise<void> {
    if (caller.kind !== 'api-key') {
      return;
    }
    const { apiKeyId, spendLimit } = caller.principal;
    if (spendLimit !== null && (await this.spendLimitFlags.isReached(apiKeyId))) {
      throw new GatewayError(
        'spend_limit_reached',
        'This API Key has reached its Spend Limit',
        'client',
      );
    }
    if (await this.isPastRequestRate(caller.principal)) {
      throw new GatewayError(
        'request_rate_exceeded',
        'This API Key has sent more requests this minute than its Request Rate allows',
        'client',
      );
    }
  }

  private async isPastRequestRate({ apiKeyId, requestRate }: ApiKeyPrincipal): Promise<boolean> {
    if (requestRate === null) {
      return false;
    }
    const { isBlocked } = await this.throttlerStorage.increment(
      `${apiKeyId}:${requestRate}`,
      REQUEST_RATE_WINDOW,
      requestRate,
      NO_BLOCK,
      REQUEST_RATE_THROTTLER,
    );
    return isBlocked;
  }
}
