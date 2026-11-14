import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import type { Env } from "../config/env.schema.js";
import { cooldownDurationMs } from "./cooldown.js";

const COOLDOWN_KEY_PREFIX = "routerlm:cooldown:";
const FAILURE_STREAK_KEY_PREFIX = "routerlm:cooldown-streak:";
// A Provider Account that has not failed for this long after its Cooldown
// ended starts again from the shortest Cooldown.
const FAILURE_STREAK_MEMORY_MS = 10 * 60_000;
// The inference path waits at most this long for Redis; past it, the
// Cooldown state is treated as unknown rather than holding the request.
const REDIS_COMMAND_TIMEOUT_MS = 250;

/**
 * Cooldown state, in Redis so every backend instance agrees on it (spec
 * "Data model"). Never throws: without Redis no Provider Account is in
 * Cooldown, which costs a failed Attempt rather than the request.
 */
@Injectable()
export class CooldownStore implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CooldownStore.name);
  private readonly redis: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.redis = new Redis(config.get("REDIS_URL", { infer: true }), {
      lazyConnect: true,
      // Fail a command at once while disconnected instead of queueing it.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    });
    // Without a listener, ioredis reports every failed reconnect as an unhandled error.
    this.redis.on("error", (error: Error) => this.logger.warn(`Redis: ${error.message}`));
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.redis.connect();
    } catch (error) {
      // ioredis keeps reconnecting in the background.
      this.logger.warn(`Redis is not reachable yet: ${String(error)}`);
    }
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }

  /**
   * Puts a Provider Account in Cooldown after a failed Attempt. Each failure
   * in a row lengthens it; the upstream's `Retry-After` can lengthen it more.
   */
  async startCooldown(providerAccountId: string, retryAfter: string | null): Promise<void> {
    try {
      const streakKey = FAILURE_STREAK_KEY_PREFIX + providerAccountId;
      const failureStreak = await this.redis.incr(streakKey);
      const durationMs = cooldownDurationMs(failureStreak, retryAfter, new Date());
      const endsAt = Date.now() + durationMs;
      await this.redis
        .multi()
        .pexpire(streakKey, durationMs + FAILURE_STREAK_MEMORY_MS)
        .set(COOLDOWN_KEY_PREFIX + providerAccountId, String(endsAt), "PX", durationMs)
        .exec();
    } catch (error) {
      this.logger.warn(
        `Cooldown not recorded for Provider Account ${providerAccountId}: ${String(error)}`,
      );
    }
  }

  /** When the Cooldown of each given Provider Account in Cooldown ends. Others are absent. */
  async cooldownEnds(providerAccountIds: string[]): Promise<Map<string, Date>> {
    const ends = new Map<string, Date>();
    if (providerAccountIds.length === 0) {
      return ends;
    }
    try {
      const values = await this.redis.mget(
        providerAccountIds.map((id) => COOLDOWN_KEY_PREFIX + id),
      );
      providerAccountIds.forEach((id, index) => {
        const endsAt = values[index];
        if (endsAt) {
          ends.set(id, new Date(Number(endsAt)));
        }
      });
    } catch (error) {
      this.logger.warn(`Cooldown state unknown, treating none as cooling down: ${String(error)}`);
    }
    return ends;
  }
}
