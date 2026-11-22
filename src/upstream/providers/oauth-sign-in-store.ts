import { Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { RedisConnection } from "@/redis/providers/redis-connection.js";
import { signInNeedsRedis } from "@/upstream/models/oauth-sign-in.js";
import {
  type StoredOauthSignIn,
  storedOauthSignInSchema,
} from "@/upstream/schemas/oauth-sign-in.schema.js";

const SIGN_IN_KEY_PREFIX = "routerlm:oauth-sign-in:";
/** How long a sign-in stays readable after its code expired or it ended, for the dashboard to show why. */
const ENDED_RETENTION_MS = 10 * 60_000;

/**
 * Sign-ins in progress, in Redis so the backend that started one, the worker
 * that polls for it and the backend that reads its state all see the same.
 * Every entry expires on its own: a sign-in nobody completes leaves nothing
 * behind. Unlike Cooldown state, a sign-in can't do without Redis, so these
 * methods throw ServiceUnavailableException while it is unreachable.
 */
@Injectable()
export class OauthSignInStore {
  private readonly redis: Redis;

  constructor(connection: RedisConnection) {
    this.redis = connection.client;
  }

  /** Stores the sign-in until a while after its code expires, or after `now` once it has ended. */
  async save(signInId: string, signIn: StoredOauthSignIn, now: Date): Promise<void> {
    const endsAt = signIn.outcome.status === "pending" ? signIn.expiresAt : now.getTime();
    const lifetimeMs = Math.max(endsAt - now.getTime(), 0) + ENDED_RETENTION_MS;
    try {
      await this.redis.set(SIGN_IN_KEY_PREFIX + signInId, JSON.stringify(signIn), "PX", lifetimeMs);
    } catch (error) {
      throw signInNeedsRedis(error);
    }
  }

  /** Null for a sign-in that never started or has been forgotten. */
  async find(signInId: string): Promise<StoredOauthSignIn | null> {
    let stored: string | null;
    try {
      stored = await this.redis.get(SIGN_IN_KEY_PREFIX + signInId);
    } catch (error) {
      throw signInNeedsRedis(error);
    }
    if (stored === null) {
      return null;
    }
    return storedOauthSignInSchema.parse(JSON.parse(stored));
  }
}
