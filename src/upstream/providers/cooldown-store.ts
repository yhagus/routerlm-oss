import { Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { ATTEMPT_FAILURE_REASONS, type AttemptFailureReason } from "@/db/schemas/index.js";
import { RedisConnection } from "@/redis/providers/redis-connection.js";
import { cooldownDurationMs } from "@/upstream/models/cooldown.js";

export const COOLDOWN_KEY_PREFIX = "routerlm:cooldown:";
const FAILURE_STREAK_KEY_PREFIX = "routerlm:cooldown-streak:";
// A Provider Account that has not failed for this long after its Cooldown
// ended starts again from the shortest Cooldown.
const FAILURE_STREAK_MEMORY_MS = 10 * 60_000;
const REFUSAL_COUNT_KEY_PREFIX = "routerlm:refusal-count:";
// Consecutive 403s are counted across Cooldowns; a count left untouched this
// long is stale rather than consecutive.
const REFUSAL_COUNT_MEMORY_MS = 60 * 60_000;
export const COOLDOWN_VALUE_SEPARATOR = ":";
/**
 * How old the inference path's local copy of a Provider Account's state may
 * be. Another backend process's Cooldown reaches this one within this long.
 */
export const LOCAL_COPY_MAX_AGE_MS = 1_000;
// readAt of a copy that a local write created before any read of Redis.
const NEVER_READ = Number.NEGATIVE_INFINITY;

/** A Provider Account's Cooldown, and the Attempt failure that started it. */
export interface Cooldown {
  endsAt: Date;
  /** Null when the stored value names no cause it knows. */
  cause: AttemptFailureReason | null;
}

/** This process's copy of one Provider Account's state in Redis. */
interface LocalCopy {
  /** Null when not in Cooldown. */
  cooldown: Cooldown | null;
  refusalCount: number;
  /** When the read that filled it was sent (epoch ms). */
  readAt: number;
  /** Writes this process made, so a read sent before one doesn't undo it. */
  localWrites: number;
}

/**
 * Cooldown state, in Redis so every backend process and instance shares it
 * (spec "Data model"). The inference path reads a local copy at most
 * LOCAL_COPY_MAX_AGE_MS old, which this process's own writes update at once;
 * so another process's change reaches it within that long, which at worst
 * costs one failed Attempt and a Fallback. Never throws: without Redis no
 * Provider Account is in Cooldown, which costs a failed Attempt rather than
 * the request.
 */
@Injectable()
export class CooldownStore {
  private readonly logger = new Logger(CooldownStore.name);
  private readonly redis: Redis;
  private readonly localCopies = new Map<string, LocalCopy>();
  // One read of Redis at a time per Provider Account, shared by every request that needs it.
  private readonly pendingReads = new Map<string, Promise<void>>();

  constructor(connection: RedisConnection) {
    this.redis = connection.client;
  }

  /**
   * Puts a Provider Account in Cooldown after a failed Attempt. Each failure
   * in a row lengthens it; the upstream's `Retry-After` can lengthen it more.
   */
  async startCooldown(
    providerAccountId: string,
    cause: AttemptFailureReason,
    retryAfter: string | null,
  ): Promise<void> {
    try {
      const streakKey = FAILURE_STREAK_KEY_PREFIX + providerAccountId;
      const failureStreak = await this.redis.incr(streakKey);
      const durationMs = cooldownDurationMs(failureStreak, retryAfter, new Date());
      const endsAt = Date.now() + durationMs;
      await this.redis
        .multi()
        .pexpire(streakKey, durationMs + FAILURE_STREAK_MEMORY_MS)
        .set(
          COOLDOWN_KEY_PREFIX + providerAccountId,
          `${endsAt}${COOLDOWN_VALUE_SEPARATOR}${cause}`,
          "PX",
          durationMs,
        )
        .exec();
      this.updateLocalCopy(providerAccountId, { cooldown: { endsAt: new Date(endsAt), cause } });
    } catch (error) {
      this.logger.warn(
        `Cooldown not recorded for Provider Account ${providerAccountId}: ${String(error)}`,
      );
    }
  }

  /**
   * Counts one more upstream 403 on a Provider Account with no successful
   * Attempt since the last, and returns the count. 0 when Redis is down, so
   * a Redis outage never disables an account.
   */
  async countRefusal(providerAccountId: string): Promise<number> {
    try {
      const key = REFUSAL_COUNT_KEY_PREFIX + providerAccountId;
      const refusalCount = await this.redis.incr(key);
      await this.redis.pexpire(key, REFUSAL_COUNT_MEMORY_MS);
      this.updateLocalCopy(providerAccountId, { refusalCount });
      return refusalCount;
    } catch (error) {
      this.logger.warn(
        `Refusal not counted for Provider Account ${providerAccountId}: ${String(error)}`,
      );
      return 0;
    }
  }

  /**
   * A successful Attempt ends the run of consecutive 403s. Skips Redis when
   * the local copy counts none, so only a success after a 403 costs a write;
   * a 403 another process counted moments ago may then stay counted.
   */
  resetRefusalsAfterSuccess(providerAccountId: string): Promise<void> {
    if (this.localCopies.get(providerAccountId)?.refusalCount === 0) {
      return Promise.resolve();
    }
    return this.resetRefusals(providerAccountId);
  }

  /** Ends the run of consecutive 403s. */
  async resetRefusals(providerAccountId: string): Promise<void> {
    try {
      await this.redis.del(REFUSAL_COUNT_KEY_PREFIX + providerAccountId);
      this.updateLocalCopy(providerAccountId, { refusalCount: 0 });
    } catch (error) {
      this.logger.warn(
        `Refusal count not reset for Provider Account ${providerAccountId}: ${String(error)}`,
      );
    }
  }

  /**
   * Skips a Provider Account until `until`, as Exhausted (GLOSSARY). Replaces
   * any Cooldown it is in; leaves its failure streak alone, since running out
   * of quota says nothing about how healthy the upstream is.
   */
  async markExhausted(providerAccountId: string, until: Date): Promise<void> {
    const durationMs = until.getTime() - Date.now();
    if (durationMs <= 0) {
      return;
    }
    try {
      await this.redis.set(
        COOLDOWN_KEY_PREFIX + providerAccountId,
        `${until.getTime()}${COOLDOWN_VALUE_SEPARATOR}exhausted`,
        "PX",
        durationMs,
      );
      this.updateLocalCopy(providerAccountId, { cooldown: { endsAt: until, cause: "exhausted" } });
    } catch (error) {
      this.logger.warn(
        `Exhausted state not recorded for Provider Account ${providerAccountId}: ${String(error)}`,
      );
    }
  }

  /** Makes an Exhausted Provider Account routable again; a Cooldown from a failure stays. */
  async endExhausted(providerAccountId: string): Promise<void> {
    try {
      const key = COOLDOWN_KEY_PREFIX + providerAccountId;
      const value = await this.redis.get(key);
      if (value !== null && cooldownOf(value).cause === "exhausted") {
        await this.redis.del(key);
        this.updateLocalCopy(providerAccountId, { cooldown: null });
      }
    } catch (error) {
      this.logger.warn(
        `Exhausted state not cleared for Provider Account ${providerAccountId}: ${String(error)}`,
      );
    }
  }

  /**
   * Like `cooldowns`, from the local copy for the inference path: reads Redis
   * only for the accounts whose copy is missing or older than
   * LOCAL_COPY_MAX_AGE_MS, in one MGET shared with concurrent requests.
   */
  async recentCooldowns(providerAccountIds: string[]): Promise<Map<string, Cooldown>> {
    const staleAccountIds = providerAccountIds.filter((id) => !this.hasFreshLocalCopy(id));
    if (staleAccountIds.length > 0) {
      await this.refreshLocalCopies(staleAccountIds);
    }
    const now = Date.now();
    const cooldowns = new Map<string, Cooldown>();
    for (const id of providerAccountIds) {
      const cooldown = this.localCopies.get(id)?.cooldown;
      // Redis's expiry would have removed it by now.
      if (cooldown && cooldown.endsAt.getTime() > now) {
        cooldowns.set(id, cooldown);
      }
    }
    return cooldowns;
  }

  /** The Cooldown of each given Provider Account in Cooldown, read from Redis. Others are absent. */
  async cooldowns(providerAccountIds: string[]): Promise<Map<string, Cooldown>> {
    const cooldowns = new Map<string, Cooldown>();
    if (providerAccountIds.length === 0) {
      return cooldowns;
    }
    try {
      const values = await this.redis.mget(
        providerAccountIds.map((id) => COOLDOWN_KEY_PREFIX + id),
      );
      providerAccountIds.forEach((id, index) => {
        const value = values[index];
        if (value) {
          cooldowns.set(id, cooldownOf(value));
        }
      });
    } catch (error) {
      this.logger.warn(`Cooldown state unknown, treating none as cooling down: ${String(error)}`);
    }
    return cooldowns;
  }

  private hasFreshLocalCopy(providerAccountId: string): boolean {
    const copy = this.localCopies.get(providerAccountId);
    return copy !== undefined && Date.now() - copy.readAt < LOCAL_COPY_MAX_AGE_MS;
  }

  /** Joins the reads already under way, and reads the other accounts in one MGET. */
  private async refreshLocalCopies(providerAccountIds: string[]): Promise<void> {
    const reads: Promise<void>[] = [];
    const unreadAccountIds: string[] = [];
    for (const id of providerAccountIds) {
      const pendingRead = this.pendingReads.get(id);
      if (pendingRead) {
        reads.push(pendingRead);
      } else {
        unreadAccountIds.push(id);
      }
    }
    if (unreadAccountIds.length > 0) {
      const read = this.readIntoLocalCopies(unreadAccountIds).finally(() => {
        for (const id of unreadAccountIds) {
          this.pendingReads.delete(id);
        }
      });
      for (const id of unreadAccountIds) {
        this.pendingReads.set(id, read);
      }
      reads.push(read);
    }
    await Promise.all(reads);
  }

  /**
   * Reads each account's Cooldown and refusal count. A failed read counts as
   * no Cooldown and no refusals until the next one, LOCAL_COPY_MAX_AGE_MS
   * later, so a Redis outage costs at most one failed read a second.
   */
  private async readIntoLocalCopies(providerAccountIds: string[]): Promise<void> {
    const readAt = Date.now();
    const localWritesBefore = providerAccountIds.map(
      (id) => this.localCopies.get(id)?.localWrites ?? 0,
    );
    let values: (string | null)[];
    try {
      values = await this.redis.mget([
        ...providerAccountIds.map((id) => COOLDOWN_KEY_PREFIX + id),
        ...providerAccountIds.map((id) => REFUSAL_COUNT_KEY_PREFIX + id),
      ]);
    } catch (error) {
      this.logger.warn(`Cooldown state unknown, treating none as cooling down: ${String(error)}`);
      values = [];
    }
    providerAccountIds.forEach((id, index) => {
      const localWrites = localWritesBefore[index];
      if ((this.localCopies.get(id)?.localWrites ?? 0) !== localWrites) {
        return;
      }
      const cooldownValue = values[index];
      const refusalCountValue = values[providerAccountIds.length + index];
      this.localCopies.set(id, {
        cooldown: cooldownValue ? cooldownOf(cooldownValue) : null,
        refusalCount: refusalCountValue ? Number(refusalCountValue) : 0,
        readAt,
        localWrites,
      });
    });
  }

  /** Applies a write this process made to Redis to its local copy. */
  private updateLocalCopy(
    providerAccountId: string,
    change: Partial<Pick<LocalCopy, "cooldown" | "refusalCount">>,
  ): void {
    const copy = this.localCopies.get(providerAccountId) ?? {
      cooldown: null,
      refusalCount: 0,
      readAt: NEVER_READ,
      localWrites: 0,
    };
    this.localCopies.set(providerAccountId, {
      ...copy,
      ...change,
      localWrites: copy.localWrites + 1,
    });
  }
}

/** Reads a stored `<end epoch ms>:<cause>` value. */
function cooldownOf(value: string): Cooldown {
  const [endsAt, cause] = value.split(COOLDOWN_VALUE_SEPARATOR);
  return {
    endsAt: new Date(Number(endsAt)),
    cause: isAttemptFailureReason(cause) ? cause : null,
  };
}

function isAttemptFailureReason(value: string | undefined): value is AttemptFailureReason {
  return ATTEMPT_FAILURE_REASONS.some((reason) => reason === value);
}
