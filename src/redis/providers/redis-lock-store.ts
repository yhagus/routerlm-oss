import { Injectable } from "@nestjs/common";
import { type LockAcquireResult, type LockStore, LocksStorage } from "@nestjs/locks";
import type { Redis } from "ioredis";
import { RedisConnection } from "./redis-connection.js";

const LOCK_KEY_PREFIX = "routerlm:lock:";
const FENCING_COUNTER_KEY = "routerlm:lock-fencing-token";

const ACQUIRE_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return redis.call('INCR', KEYS[2])
end
return 0`;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

@Injectable()
export class RedisLockStore implements LockStore {
  private readonly redis: Redis;

  constructor(connection: RedisConnection, storage: LocksStorage) {
    this.redis = connection.client;
    storage.registerSource(this);
  }

  async acquire(key: string, owner: string, ttl: number): Promise<LockAcquireResult> {
    const fencingToken = Number(
      await this.redis.eval(ACQUIRE_SCRIPT, 2, lockKey(key), FENCING_COUNTER_KEY, owner, ttl),
    );
    return fencingToken > 0 ? { acquired: true, fencingToken } : { acquired: false };
  }

  async renew(key: string, owner: string, ttl: number): Promise<boolean> {
    return (await this.redis.eval(RENEW_SCRIPT, 1, lockKey(key), owner, ttl)) === 1;
  }

  async release(key: string, owner: string): Promise<boolean> {
    return (await this.redis.eval(RELEASE_SCRIPT, 1, lockKey(key), owner)) === 1;
  }
}

function lockKey(key: string): string {
  return LOCK_KEY_PREFIX + key;
}
