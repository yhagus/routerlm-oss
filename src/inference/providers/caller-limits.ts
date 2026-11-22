import { Injectable } from "@nestjs/common";
import { InjectThrottlerStorage, minutes, type ThrottlerStorage } from "@nestjs/throttler";
import type { ApiKeyPrincipal } from "@/api-keys/models/api-key.js";
import { SpendLimitFlags } from "@/spend-limits/providers/spend-limit-flags.js";
import { GatewayError } from "@/inference/models/gateway-error.js";
import type { InferenceCaller } from "@/inference/models/inference.js";

const REQUEST_RATE_THROTTLER = "request-rate";
const REQUEST_RATE_WINDOW = minutes(1);
// No block past the window: a key is refused only while it is over its rate
// in the current window, not for a further window after it went over.
const NO_BLOCK = 0;

/**
 * The limits an API Key sets on its own requests (ADR 0034), checked before
 * a request is served. A request already running is never stopped by them.
 */
@Injectable()
export class CallerLimits {
  constructor(
    private readonly spendLimitFlags: SpendLimitFlags,
    @InjectThrottlerStorage() private readonly throttlerStorage: ThrottlerStorage,
  ) {}

  async assertWithinLimits(caller: InferenceCaller): Promise<void> {
    if (caller.kind !== "api-key") {
      return;
    }
    const { apiKeyId, spendLimit } = caller.principal;
    if (spendLimit !== null && (await this.spendLimitFlags.isReached(apiKeyId))) {
      throw new GatewayError(
        "spend_limit_reached",
        "This API Key has reached its Spend Limit",
        "client",
      );
    }
    if (await this.isPastRequestRate(caller.principal)) {
      throw new GatewayError(
        "request_rate_exceeded",
        "This API Key has sent more requests this minute than its Request Rate allows",
        "client",
      );
    }
  }

  /**
   * Counts the request in the throttler's Redis storage (ADR 0021), shared by
   * every gateway process. While Redis is down nothing is counted and the
   * request goes through.
   */
  private async isPastRequestRate({ apiKeyId, requestRate }: ApiKeyPrincipal): Promise<boolean> {
    if (requestRate === null) {
      return false;
    }
    // The rate is part of the key so a changed Request Rate starts a fresh
    // count at once, instead of after the window counted under the old one.
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
