import { Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { RedisConnection } from "@/redis/providers/redis-connection";
import { signInNeedsRedis } from "@/upstream/models/oauth-sign-in";
import {
  type StoredOauthSignIn,
  storedOauthSignInSchema,
} from "@/upstream/schemas/oauth-sign-in.schema";

const SIGN_IN_KEY_PREFIX = "routerlm:oauth-sign-in:";
const ENDED_RETENTION_MS = 10 * 60_000;

@Injectable()
export class OauthSignInStore {
  private readonly redis: Redis;

  constructor(connection: RedisConnection) {
    this.redis = connection.client;
  }

  async save(signInId: string, signIn: StoredOauthSignIn, now: Date): Promise<void> {
    const endsAt = signIn.outcome.status === "pending" ? signIn.expiresAt : now.getTime();
    const lifetimeMs = Math.max(endsAt - now.getTime(), 0) + ENDED_RETENTION_MS;
    try {
      await this.redis.set(SIGN_IN_KEY_PREFIX + signInId, JSON.stringify(signIn), "PX", lifetimeMs);
    } catch (error) {
      throw signInNeedsRedis(error);
    }
  }

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
