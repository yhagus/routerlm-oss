import { Logger } from "@nestjs/common";
import { z } from "zod";
import type { ThrottlerStorage } from "@nestjs/throttler";
import { RedisConnection } from "@/redis/providers/redis-connection.js";

// The package does not export its record type.
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage["increment"]>>;

const KEY_PREFIX = "routerlm:throttle:";
const MILLISECONDS_PER_SECOND = 1000;

// Counts a hit in one atomic step so replicas share the count. Once the limit
// is passed the key is blocked for the block duration and stops counting.
// With no block duration nothing outlives the window: every hit past the
// limit is refused until the window ends and its count expires.
// Returns {hits, milliseconds until the window ends, milliseconds blocked}.
const INCREMENT_SCRIPT = `
local blockedFor = redis.call('PTTL', KEYS[2])
if blockedFor > 0 then
  return {tonumber(ARGV[2]) + 1, redis.call('PTTL', KEYS[1]), blockedFor}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local windowLeft = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  if tonumber(ARGV[3]) > 0 then
    redis.call('SET', KEYS[2], 1, 'PX', ARGV[3])
    blockedFor = tonumber(ARGV[3])
  else
    blockedFor = windowLeft
  end
end
return {hits, windowLeft, blockedFor}`;

const scriptResultSchema = z.tuple([z.number(), z.number(), z.number()]);

const UNCOUNTED_HIT: ThrottlerStorageRecord = {
  totalHits: 0,
  timeToExpire: 0,
  isBlocked: false,
  timeToBlockExpire: 0,
};

/**
 * The hit counts of `@nestjs/throttler`, kept in Redis (ADR 0021). Redis is
 * optional: while it is unreachable nothing is counted, so a throttled route
 * stays open instead of failing.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly redis: RedisConnection) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `${KEY_PREFIX}${throttlerName}:${key}`;
    try {
      const reply = await this.redis.client.eval(
        INCREMENT_SCRIPT,
        2,
        hitsKey,
        `${hitsKey}:blocked`,
        ttl,
        limit,
        blockDuration,
      );
      const [totalHits, windowLeft, blockedFor] = scriptResultSchema.parse(reply);
      return {
        totalHits,
        timeToExpire: Math.ceil(windowLeft / MILLISECONDS_PER_SECOND),
        isBlocked: blockedFor > 0,
        timeToBlockExpire: Math.ceil(blockedFor / MILLISECONDS_PER_SECOND),
      };
    } catch (error) {
      this.logger.warn(`Request not counted, Redis failed: ${String(error)}`);
      return UNCOUNTED_HIT;
    }
  }
}
