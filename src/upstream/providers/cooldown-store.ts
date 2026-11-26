import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ATTEMPT_FAILURE_REASONS, type AttemptFailureReason } from '@/db/schemas';
import { RedisConnection } from '@/redis/providers/redis-connection';
import { cooldownDurationMs } from '@/upstream/models/cooldown';

export const COOLDOWN_KEY_PREFIX = 'routerlm:cooldown:';
const FAILURE_STREAK_KEY_PREFIX = 'routerlm:cooldown-streak:';
const FAILURE_STREAK_MEMORY_MS = 10 * 60_000;
const REFUSAL_COUNT_KEY_PREFIX = 'routerlm:refusal-count:';
const REFUSAL_COUNT_MEMORY_MS = 60 * 60_000;
export const COOLDOWN_VALUE_SEPARATOR = ':';
export const LOCAL_COPY_MAX_AGE_MS = 1_000;
const NEVER_READ = Number.NEGATIVE_INFINITY;

export interface Cooldown {
  endsAt: Date;
  cause: AttemptFailureReason | null;
}

interface LocalCopy {
  cooldown: Cooldown | null;
  refusalCount: number;
  readAt: number;
  localWrites: number;
}

@Injectable()
export class CooldownStore {
  private readonly logger = new Logger(CooldownStore.name);
  private readonly redis: Redis;
  private readonly localCopies = new Map<string, LocalCopy>();
  private readonly pendingReads = new Map<string, Promise<void>>();

  constructor(connection: RedisConnection) {
    this.redis = connection.client;
  }

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
          'PX',
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

  resetRefusalsAfterSuccess(providerAccountId: string): Promise<void> {
    if (this.localCopies.get(providerAccountId)?.refusalCount === 0) {
      return Promise.resolve();
    }
    return this.resetRefusals(providerAccountId);
  }

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

  async markExhausted(providerAccountId: string, until: Date): Promise<void> {
    const durationMs = until.getTime() - Date.now();
    if (durationMs <= 0) {
      return;
    }
    try {
      await this.redis.set(
        COOLDOWN_KEY_PREFIX + providerAccountId,
        `${until.getTime()}${COOLDOWN_VALUE_SEPARATOR}exhausted`,
        'PX',
        durationMs,
      );
      this.updateLocalCopy(providerAccountId, { cooldown: { endsAt: until, cause: 'exhausted' } });
    } catch (error) {
      this.logger.warn(
        `Exhausted state not recorded for Provider Account ${providerAccountId}: ${String(error)}`,
      );
    }
  }

  async endExhausted(providerAccountId: string): Promise<void> {
    try {
      const key = COOLDOWN_KEY_PREFIX + providerAccountId;
      const value = await this.redis.get(key);
      if (value !== null && cooldownOf(value).cause === 'exhausted') {
        await this.redis.del(key);
        this.updateLocalCopy(providerAccountId, { cooldown: null });
      }
    } catch (error) {
      this.logger.warn(
        `Exhausted state not cleared for Provider Account ${providerAccountId}: ${String(error)}`,
      );
    }
  }

  async recentCooldowns(providerAccountIds: string[]): Promise<Map<string, Cooldown>> {
    const staleAccountIds = providerAccountIds.filter((id) => !this.hasFreshLocalCopy(id));
    if (staleAccountIds.length > 0) {
      await this.refreshLocalCopies(staleAccountIds);
    }
    const now = Date.now();
    const cooldowns = new Map<string, Cooldown>();
    for (const id of providerAccountIds) {
      const cooldown = this.localCopies.get(id)?.cooldown;
      if (cooldown && cooldown.endsAt.getTime() > now) {
        cooldowns.set(id, cooldown);
      }
    }
    return cooldowns;
  }

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

  private updateLocalCopy(
    providerAccountId: string,
    change: Partial<Pick<LocalCopy, 'cooldown' | 'refusalCount'>>,
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
