import { Injectable } from "@nestjs/common";
import { SpendLimitFlags } from "@/spend-limits/providers/spend-limit-flags.js";
import { GatewayError } from "../models/gateway-error.js";
import type { InferenceCaller } from "../models/inference.js";

/**
 * The limits an API Key sets on its own requests (ADR 0034), checked before
 * a request is served. A request already running is never stopped by them.
 */
@Injectable()
export class CallerLimits {
  constructor(private readonly spendLimitFlags: SpendLimitFlags) {}

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
  }
}
