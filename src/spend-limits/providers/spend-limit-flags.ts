import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { apiKeys } from '@/db/schemas';
import type { Database } from '@/db/schemas/relations';
import { RedisConnection } from '@/redis/providers/redis-connection';

const FLAG_KEY_PREFIX = 'routerlm:spend-limit-reached:';
const REACHED = '1';
const NOT_REACHED = '0';
const FLAG_TTL_SECONDS = 600;

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

  async isReached(apiKeyId: string): Promise<boolean> {
    if ((await this.readFlag(apiKeyId)) === NOT_REACHED) {
      return false;
    }
    return this.recompute(apiKeyId);
  }

  async recompute(apiKeyId: string): Promise<boolean> {
    const [spend] = await this.db
      .select({ isReached: sql<boolean | null>`${apiKeys.spent} >= ${apiKeys.spendLimit}` })
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyId));
    const isReached = spend?.isReached === true;
    await this.write(apiKeyId, isReached);
    return isReached;
  }

  async write(apiKeyId: string, isReached: boolean): Promise<void> {
    try {
      await this.redis.set(
        flagKey(apiKeyId),
        isReached ? REACHED : NOT_REACHED,
        'EX',
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
