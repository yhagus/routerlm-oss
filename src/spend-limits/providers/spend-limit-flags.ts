import { Injectable, Logger } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { apiKeys } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import { RedisConnection } from "@/redis/providers/redis-connection.js";

const FLAG_KEY_PREFIX = "routerlm:spend-limit-reached:";
const REACHED = "1";
const NOT_REACHED = "0";
// Bounds how long a flag can stay wrong when a write after it was lost
// (Redis down); a missing flag only costs one Postgres read.
const FLAG_TTL_SECONDS = 600;

/** What an API Key has spent and may spend, in USD. A null limit means no Spend Limit. */
export interface KeySpend {
  spent: number;
  spendLimit: number | null;
}

/** Whether the key may serve no more requests: it has a Spend Limit and has spent it. */
export function hasReachedSpendLimit({ spent, spendLimit }: KeySpend): boolean {
  return spendLimit !== null && spent >= spendLimit;
}

/**
 * Each API Key's "limit reached" flag in Redis (ADR 0035). Postgres holds
 * what the key has spent; the flag lets the inference path check it with one
 * Redis read. Redis is optional: without it, Postgres answers.
 */
@Injectable()
export class SpendLimitFlags {
  private readonly logger = new Logger(SpendLimitFlags.name);
  private readonly redis: Redis;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    connection: RedisConnection,
  ) {
    this.redis = connection.client;
  }

  /**
   * Whether the key has reached its Spend Limit. Without a flag (Redis lost
   * it, never had it, or can't be reached), Postgres answers and the flag is
   * written back: a key over its limit is never let through for lack of one.
   */
  async isReached(apiKeyId: string): Promise<boolean> {
    const flag = await this.readFlag(apiKeyId);
    if (flag === REACHED || flag === NOT_REACHED) {
      return flag === REACHED;
    }
    return this.recompute(apiKeyId);
  }

  /** Writes the key's flag from what Postgres holds now, after its Spend Limit changed. Returns it. */
  async recompute(apiKeyId: string): Promise<boolean> {
    const [spend] = await this.db
      .select({ spent: apiKeys.spent, spendLimit: apiKeys.spendLimit })
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyId));
    const isReached = spend ? hasReachedSpendLimit(spend) : false;
    await this.write(apiKeyId, isReached);
    return isReached;
  }

  /** Never throws: a flag that can't be written is logged, and expires or is recomputed later. */
  async write(apiKeyId: string, isReached: boolean): Promise<void> {
    try {
      await this.redis.set(
        flagKey(apiKeyId),
        isReached ? REACHED : NOT_REACHED,
        "EX",
        FLAG_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Could not write the Spend Limit flag of API Key ${apiKeyId}: ${String(error)}`,
      );
    }
  }

  private async readFlag(apiKeyId: string): Promise<string | null> {
    try {
      return await this.redis.get(flagKey(apiKeyId));
    } catch {
      return null;
    }
  }
}

function flagKey(apiKeyId: string): string {
  return FLAG_KEY_PREFIX + apiKeyId;
}
