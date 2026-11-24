import { Logger } from "@nestjs/common";
import { z } from "zod";
import type { ThrottlerStorage } from "@nestjs/throttler";
import { RedisConnection } from "@/redis/providers/redis-connection.js";

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage["increment"]>>;

export const THROTTLE_KEY_PREFIX = "routerlm:throttle:";
const MILLISECONDS_PER_SECOND = 1000;

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
    const hitsKey = `${THROTTLE_KEY_PREFIX}${throttlerName}:${key}`;
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
