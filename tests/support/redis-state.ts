import type { INestApplicationContext } from '@nestjs/common';
import { THROTTLE_KEY_PREFIX } from '@/libs/providers/redis-throttler-storage';
import { RedisConnection } from '@/redis/providers/redis-connection';
import { COOLDOWN_KEY_PREFIX, COOLDOWN_VALUE_SEPARATOR } from '@/upstream/providers/cooldown-store';

export async function forgetThrottleCounts(app: INestApplicationContext): Promise<void> {
  const { client } = app.get(RedisConnection);
  const keys = await client.keys(`${THROTTLE_KEY_PREFIX}*`);
  if (keys.length > 0) await client.del(...keys);
}

export async function startCooldownElsewhere(
  app: INestApplicationContext,
  providerAccountId: string,
  endsAt: number,
): Promise<void> {
  await app
    .get(RedisConnection)
    .client.set(
      COOLDOWN_KEY_PREFIX + providerAccountId,
      `${endsAt}${COOLDOWN_VALUE_SEPARATOR}rate_limited`,
      'PX',
      Math.max(endsAt - Date.now(), 1),
    );
}

export async function endCooldownElsewhere(
  app: INestApplicationContext,
  providerAccountId: string,
): Promise<void> {
  await app.get(RedisConnection).client.del(COOLDOWN_KEY_PREFIX + providerAccountId);
}
