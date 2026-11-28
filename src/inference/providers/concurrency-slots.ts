import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { Redis } from 'ioredis';
import { BackgroundWork } from '@/libs/providers/background-work';
import { RedisConnection } from '@/redis/providers/redis-connection';
import { ShowConcurrencyWaitQuery } from '@/settings/queries/impl/show-concurrency-wait.query';
import {
  holderKeyOf,
  slotKeysOf,
  TICKET_SEQUENCE_KEY,
  WAITING_REQUEST_LEASES_KEY,
  WAITING_REQUESTS_KEY,
} from '@/inference/models/concurrency-keys';
import {
  type HeldSlot,
  type SlotHolder,
  SlotWait,
  SlotWaitAbandonedError,
  slotWaitExceededError,
  UNCOUNTED_SLOT,
} from '@/inference/models/concurrency-slot';
import type {
  WaitingRequestDescriptor,
  WaitsFor,
} from '@/inference/schemas/waiting-request.schema';

const SLOT_FREED_CHANNEL = 'routerlm:concurrency-slot-freed';
const HELD_LEASE_MS = 30_000;
const WAITER_LEASE_MS = 3_000;
const LEASE_RENEWAL_INTERVAL_MS = 10_000;
const WAKE_UP_POLL_MS = 500;
const MS_PER_SECOND = 1000;
const TAKE_SCRIPT_KEY_COUNT = 4;
const DESCRIBE_WAITER_SCRIPT_KEY_COUNT = 2;

const TAKE_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local heldLeaseMs = tonumber(ARGV[3])
local waiterLeaseMs = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
for _, lapsed in ipairs(redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)) do
  redis.call('ZREM', KEYS[2], lapsed)
  redis.call('ZREM', KEYS[3], lapsed)
end
local place = redis.call('ZRANK', KEYS[2], ARGV[1])
local ahead = place or redis.call('ZCARD', KEYS[2])
if redis.call('ZCARD', KEYS[1]) + ahead < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], now + heldLeaseMs, ARGV[1])
  redis.call('PEXPIRE', KEYS[1], heldLeaseMs)
  redis.call('ZREM', KEYS[2], ARGV[1])
  redis.call('ZREM', KEYS[3], ARGV[1])
  return 1
end
if ARGV[4] == '1' then
  if not place then
    redis.call('ZADD', KEYS[2], redis.call('INCR', KEYS[4]), ARGV[1])
  end
  redis.call('ZADD', KEYS[3], now + waiterLeaseMs, ARGV[1])
  redis.call('PEXPIRE', KEYS[2], waiterLeaseMs)
  redis.call('PEXPIRE', KEYS[3], waiterLeaseMs)
end
return 0`;

const RENEW_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if redis.call('ZADD', KEYS[1], 'XX', 'CH', now + tonumber(ARGV[2]), ARGV[1]) == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0`;

const DESCRIBE_WAITER_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local waiterLeaseMs = tonumber(ARGV[3])
for _, lapsed in ipairs(redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)) do
  redis.call('HDEL', KEYS[1], lapsed)
  redis.call('ZREM', KEYS[2], lapsed)
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZADD', KEYS[2], now + waiterLeaseMs, ARGV[1])
redis.call('PEXPIRE', KEYS[1], waiterLeaseMs)
redis.call('PEXPIRE', KEYS[2], waiterLeaseMs)
return 0`;

type TakeOutcome = 'taken' | 'full' | 'unavailable';

interface TicketPlaces {
  holdersAsked: Set<SlotHolder>;
  linesJoined: Set<SlotHolder>;
}

export interface TakenSlot {
  holder: SlotHolder;
  slot: HeldSlot;
}

@Injectable()
export class ConcurrencySlots implements OnApplicationBootstrap {
  private readonly logger = new Logger(ConcurrencySlots.name);
  private readonly redis: Redis;
  private readonly subscriber: Redis;
  private readonly wakeUpsByHolderKey = new Map<string, Set<() => void>>();

  constructor(
    connection: RedisConnection,
    private readonly queryBus: QueryBus,
    private readonly backgroundWork: BackgroundWork,
  ) {
    this.redis = connection.client;
    this.subscriber = connection.createSubscriber();
  }

  onApplicationBootstrap(): void {
    this.subscriber.on('message', (_channel: string, holderKey: string) => {
      for (const wakeUp of this.wakeUpsByHolderKey.get(holderKey) ?? []) {
        wakeUp();
      }
    });
    this.subscriber.on('ready', () => {
      this.subscriber.subscribe(SLOT_FREED_CHANNEL).catch((error: unknown) => {
        this.logger.warn(`Not subscribed to freed concurrency slots: ${String(error)}`);
      });
    });
    this.subscriber.connect().catch((error: unknown) => {
      this.logger.warn(`Freed concurrency slots not heard yet: ${String(error)}`);
    });
  }

  async takeIfFree(holder: SlotHolder, wait: SlotWait): Promise<HeldSlot | null> {
    const limit = holder.currentLimit();
    if (limit === null) {
      return UNCOUNTED_SLOT;
    }
    const ticket = randomUUID();
    switch (await this.take(holder, ticket, limit, false)) {
      case 'taken':
        return this.leased(holder, ticket, wait);
      case 'full':
        return null;
      case 'unavailable':
        this.backgroundWork.run(this.withdraw([holder], ticket));
        return UNCOUNTED_SLOT;
    }
  }

  async takeFirstFree(holders: SlotHolder[], wait: SlotWait): Promise<TakenSlot> {
    const ticket = randomUUID();
    const startedMs = performance.now();
    const holdersAsked = new Set<SlotHolder>();
    const linesJoined = new Set<SlotHolder>();
    let taken: TakenSlot | null = null;
    let description: string | null = null;
    try {
      while (!taken) {
        taken = await this.takeAnyInTurn(holders, ticket, wait, { holdersAsked, linesJoined });
        if (!taken) {
          description ??= await this.descriptionOf(holders, wait);
          await this.describeWaiter(ticket, description);
          await this.waitForTurn(holders, wait);
        }
      }
      return taken;
    } finally {
      const holdersToLeave = holdersToWithdrawFrom(holdersAsked, taken);
      if (holdersToLeave.length > 0 || description !== null) {
        this.backgroundWork.run(this.withdraw(holdersToLeave, ticket));
      }
      if (linesJoined.size > 0) {
        wait.waited(performance.now() - startedMs);
      }
    }
  }

  private async takeAnyInTurn(
    holders: SlotHolder[],
    ticket: string,
    wait: SlotWait,
    { holdersAsked, linesJoined }: TicketPlaces,
  ): Promise<TakenSlot | null> {
    if (wait.clientSignal.aborted) {
      throw new SlotWaitAbandonedError();
    }
    for (const holder of holders) {
      const limit = holder.currentLimit();
      if (limit === null) {
        return { holder, slot: UNCOUNTED_SLOT };
      }
      holdersAsked.add(holder);
      switch (await this.take(holder, ticket, limit, true)) {
        case 'taken':
          return { holder, slot: this.leased(holder, ticket, wait) };
        case 'unavailable':
          return { holder, slot: UNCOUNTED_SLOT };
        case 'full':
          linesJoined.add(holder);
      }
    }
    return null;
  }

  private async waitForTurn(holders: SlotHolder[], wait: SlotWait): Promise<void> {
    const remainingMs = (await wait.deadline(() => this.waitBudgetMs())) - performance.now();
    if (remainingMs <= 0) {
      throw slotWaitExceededError(holders[0].kind);
    }
    await this.nextWakeUp(holders, Math.min(remainingMs, WAKE_UP_POLL_MS), wait.clientSignal);
  }

  private nextWakeUp(
    holders: SlotHolder[],
    timeoutMs: number,
    clientSignal: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (clientSignal.aborted) {
        reject(new SlotWaitAbandonedError());
        return;
      }
      const stopListening = (): void => {
        clearTimeout(timer);
        clientSignal.removeEventListener('abort', abandon);
        for (const holder of holders) {
          this.wakeUpsByHolderKey.get(holderKeyOf(holder))?.delete(wakeUp);
        }
      };
      const wakeUp = (): void => {
        stopListening();
        resolve();
      };
      const abandon = (): void => {
        stopListening();
        reject(new SlotWaitAbandonedError());
      };
      const timer = setTimeout(wakeUp, timeoutMs);
      clientSignal.addEventListener('abort', abandon, { once: true });
      for (const holder of holders) {
        const key = holderKeyOf(holder);
        const wakeUps = this.wakeUpsByHolderKey.get(key) ?? new Set();
        wakeUps.add(wakeUp);
        this.wakeUpsByHolderKey.set(key, wakeUps);
      }
    });
  }

  private async descriptionOf(holders: SlotHolder[], wait: SlotWait): Promise<string> {
    const remainingMs = (await wait.deadline(() => this.waitBudgetMs())) - performance.now();
    const now = Date.now();
    const descriptor: WaitingRequestDescriptor = {
      waitingSince: new Date(now).toISOString(),
      deadline: new Date(now + remainingMs).toISOString(),
      waitsFor: waitsForOf(holders),
      ...wait.requester(),
    };
    return JSON.stringify(descriptor);
  }

  private async describeWaiter(ticket: string, description: string): Promise<void> {
    try {
      await this.redis.eval(
        DESCRIBE_WAITER_SCRIPT,
        DESCRIBE_WAITER_SCRIPT_KEY_COUNT,
        WAITING_REQUESTS_KEY,
        WAITING_REQUEST_LEASES_KEY,
        ticket,
        description,
        WAITER_LEASE_MS,
      );
    } catch (error) {
      this.logger.warn(`Waiting Request not described: ${String(error)}`);
    }
  }

  private async waitBudgetMs(): Promise<number> {
    const { seconds } = await this.queryBus.execute(new ShowConcurrencyWaitQuery());
    return seconds * MS_PER_SECOND;
  }

  private async take(
    holder: SlotHolder,
    ticket: string,
    limit: number,
    joinsLine: boolean,
  ): Promise<TakeOutcome> {
    const { held, line, lineLeases } = slotKeysOf(holder);
    try {
      const isTaken = await this.redis.eval(
        TAKE_SCRIPT,
        TAKE_SCRIPT_KEY_COUNT,
        held,
        line,
        lineLeases,
        TICKET_SEQUENCE_KEY,
        ticket,
        limit,
        HELD_LEASE_MS,
        joinsLine ? 1 : 0,
        WAITER_LEASE_MS,
      );
      return isTaken === 1 ? 'taken' : 'full';
    } catch (error) {
      this.logger.warn(`Concurrency of ${holderKeyOf(holder)} not counted: ${String(error)}`);
      return 'unavailable';
    }
  }

  private leased(holder: SlotHolder, ticket: string, wait: SlotWait): HeldSlot {
    let isReleased = false;
    const renewal = setInterval(() => {
      this.backgroundWork.run(this.renew(holder, ticket));
    }, LEASE_RENEWAL_INTERVAL_MS);
    renewal.unref();
    const release = (): void => {
      if (isReleased) {
        return;
      }
      isReleased = true;
      clearInterval(renewal);
      wait.clientSignal.removeEventListener('abort', release);
      this.backgroundWork.run(this.giveBack(holder, ticket));
    };
    wait.clientSignal.addEventListener('abort', release, { once: true });
    if (wait.clientSignal.aborted) {
      release();
    }
    return { release };
  }

  private async renew(holder: SlotHolder, ticket: string): Promise<void> {
    try {
      await this.redis.eval(RENEW_SCRIPT, 1, slotKeysOf(holder).held, ticket, HELD_LEASE_MS);
    } catch (error) {
      this.logger.warn(`Slot of ${holderKeyOf(holder)} not renewed: ${String(error)}`);
    }
  }

  private async giveBack(holder: SlotHolder, ticket: string): Promise<void> {
    try {
      await this.redis
        .multi()
        .zrem(slotKeysOf(holder).held, ticket)
        .publish(SLOT_FREED_CHANNEL, holderKeyOf(holder))
        .exec();
    } catch (error) {
      this.logger.warn(`Slot of ${holderKeyOf(holder)} not given back: ${String(error)}`);
    }
  }

  private async withdraw(holders: SlotHolder[], ticket: string): Promise<void> {
    try {
      const transaction = this.redis
        .multi()
        .hdel(WAITING_REQUESTS_KEY, ticket)
        .zrem(WAITING_REQUEST_LEASES_KEY, ticket);
      for (const holder of holders) {
        const { held, line, lineLeases } = slotKeysOf(holder);
        transaction
          .zrem(held, ticket)
          .zrem(line, ticket)
          .zrem(lineLeases, ticket)
          .publish(SLOT_FREED_CHANNEL, holderKeyOf(holder));
      }
      await transaction.exec();
    } catch (error) {
      this.logger.warn(`Place in line not given up: ${String(error)}`);
    }
  }
}

function holdersToWithdrawFrom(
  holdersAsked: Set<SlotHolder>,
  taken: TakenSlot | null,
): SlotHolder[] {
  if (taken === null || taken.slot === UNCOUNTED_SLOT) {
    return [...holdersAsked];
  }
  return [...holdersAsked].filter((holder) => holder !== taken.holder);
}

function waitsForOf(holders: SlotHolder[]): WaitsFor {
  const [first] = holders;
  if (first.kind === 'api-key') {
    return { kind: 'api-key', apiKeyId: first.id };
  }
  return { kind: 'provider-accounts', providerAccountIds: holders.map(({ id }) => id) };
}
