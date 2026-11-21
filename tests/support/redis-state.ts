import type { INestApplicationContext } from "@nestjs/common";
import { THROTTLE_KEY_PREFIX } from "@/libs/providers/redis-throttler-storage.js";
import { RedisConnection } from "@/redis/providers/redis-connection.js";
import {
  COOLDOWN_KEY_PREFIX,
  COOLDOWN_VALUE_SEPARATOR,
} from "@/upstream/providers/cooldown-store.js";

// The one place tests touch the gateway's Redis layout. A test that needs
// shared state another process would write (or time that would pass) calls
// these, so a test file never spells a Redis key.

/** Ends every throttling window early (login attempts, Request Rates), as if a minute had passed. */
export async function forgetThrottleCounts(app: INestApplicationContext): Promise<void> {
  const { client } = app.get(RedisConnection);
  const keys = await client.keys(`${THROTTLE_KEY_PREFIX}*`);
  if (keys.length > 0) await client.del(...keys);
}

/** Puts a Provider Account in Cooldown until `endsAt`, as another gateway process would after a rate limit. */
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
      "PX",
      Math.max(endsAt - Date.now(), 1),
    );
}

/** Ends a Provider Account's Cooldown, as another gateway process would. */
export async function endCooldownElsewhere(
  app: INestApplicationContext,
  providerAccountId: string,
): Promise<void> {
  await app.get(RedisConnection).client.del(COOLDOWN_KEY_PREFIX + providerAccountId);
}
