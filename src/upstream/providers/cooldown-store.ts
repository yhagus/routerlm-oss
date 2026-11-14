import { Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { ATTEMPT_FAILURE_REASONS, type AttemptFailureReason } from "@/db/schemas/index.js";
import { RedisConnection } from "@/redis/providers/redis-connection.js";
import { cooldownDurationMs } from "../models/cooldown.js";

const COOLDOWN_KEY_PREFIX = "routerlm:cooldown:";
const FAILURE_STREAK_KEY_PREFIX = "routerlm:cooldown-streak:";
// A Provider Account that has not failed for this long after its Cooldown
// ended starts again from the shortest Cooldown.
const FAILURE_STREAK_MEMORY_MS = 10 * 60_000;
const COOLDOWN_VALUE_SEPARATOR = ":";

/** A Provider Account's Cooldown, and the Attempt failure that started it. */
export interface Cooldown {
  endsAt: Date;
  /** Null when the stored value names no cause it knows. */
  cause: AttemptFailureReason | null;
}

/**
 * Cooldown state, in Redis so every backend instance agrees on it (spec
 * "Data model"). Never throws: without Redis no Provider Account is in
 * Cooldown, which costs a failed Attempt rather than the request.
 */
@Injectable()
export class CooldownStore {
  private readonly logger = new Logger(CooldownStore.name);
  private readonly redis: Redis;

  constructor(connection: RedisConnection) {
    this.redis = connection.client;
  }

  /**
   * Puts a Provider Account in Cooldown after a failed Attempt. Each failure
   * in a row lengthens it; the upstream's `Retry-After` can lengthen it more.
   */
  async startCooldown(
    providerAccountId: string,
    cause: AttemptFailureReason,
    retryAfter: string | null,
  ): Promise<void> {
    try {
      const streakKey = FAILURE_STREAK_KEY_PREFIX + providerAccountId;
      const failureStreak = await this.redis.incr(streakKey);
      const durationMs = cooldownDurationMs(failureStreak, retryAfter, new Date());
      const endsAt = Date.now() + durationMs;
      await this.redis
        .multi()
        .pexpire(streakKey, durationMs + FAILURE_STREAK_MEMORY_MS)
        .set(
          COOLDOWN_KEY_PREFIX + providerAccountId,
          `${endsAt}${COOLDOWN_VALUE_SEPARATOR}${cause}`,
          "PX",
          durationMs,
        )
        .exec();
    } catch (error) {
      this.logger.warn(
        `Cooldown not recorded for Provider Account ${providerAccountId}: ${String(error)}`,
      );
    }
  }

  /** The Cooldown of each given Provider Account in Cooldown. Others are absent. */
  async cooldowns(providerAccountIds: string[]): Promise<Map<string, Cooldown>> {
    const cooldowns = new Map<string, Cooldown>();
    if (providerAccountIds.length === 0) {
      return cooldowns;
    }
    try {
      const values = await this.redis.mget(
        providerAccountIds.map((id) => COOLDOWN_KEY_PREFIX + id),
      );
      providerAccountIds.forEach((id, index) => {
        const value = values[index];
        if (value) {
          cooldowns.set(id, cooldownOf(value));
        }
      });
    } catch (error) {
      this.logger.warn(`Cooldown state unknown, treating none as cooling down: ${String(error)}`);
    }
    return cooldowns;
  }
}

/** Reads a stored `<end epoch ms>:<cause>` value. */
function cooldownOf(value: string): Cooldown {
  const [endsAt, cause] = value.split(COOLDOWN_VALUE_SEPARATOR);
  return {
    endsAt: new Date(Number(endsAt)),
    cause: isAttemptFailureReason(cause) ? cause : null,
  };
}

function isAttemptFailureReason(value: string | undefined): value is AttemptFailureReason {
  return ATTEMPT_FAILURE_REASONS.some((reason) => reason === value);
}
