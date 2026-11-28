import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  holderKeyOf,
  slotKeysOf,
  WAITING_REQUEST_LEASES_KEY,
  WAITING_REQUESTS_KEY,
} from '@/inference/models/concurrency-keys';
import type { SlotHolderRef } from '@/inference/models/concurrency-slot';
import {
  type WaitingRequestDescriptor,
  waitingRequestDescriptorSchema,
} from '@/inference/schemas/waiting-request.schema';
import { RedisConnection } from '@/redis/providers/redis-connection';

const REDIS_NOW = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)`;

const COUNT_SCRIPT = `${REDIS_NOW}
return redis.call('ZCOUNT', KEYS[1], '(' .. now, '+inf')`;

const DESCRIPTIONS_SCRIPT = `${REDIS_NOW}
local described = {}
for _, ticket in ipairs(redis.call('ZRANGEBYSCORE', KEYS[2], '(' .. now, '+inf')) do
  local description = redis.call('HGET', KEYS[1], ticket)
  if description then
    table.insert(described, ticket)
    table.insert(described, description)
  end
end
return described`;

const LINES_SCRIPT = `${REDIS_NOW}
local lines = {}
for first = 1, #KEYS, 3 do
  local liveTickets = {}
  for _, ticket in ipairs(redis.call('ZRANGE', KEYS[first + 1], 0, -1)) do
    local leaseEnd = redis.call('ZSCORE', KEYS[first + 2], ticket)
    if leaseEnd and tonumber(leaseEnd) > now then
      table.insert(liveTickets, ticket)
    end
  end
  table.insert(lines, redis.call('ZCOUNT', KEYS[first], '(' .. now, '+inf'))
  table.insert(lines, liveTickets)
end
return lines`;

const DESCRIPTIONS_SCRIPT_KEY_COUNT = 2;
const COUNT_SCRIPT_KEY_COUNT = 1;

export interface DescribedWaiter {
  ticket: string;
  descriptor: WaitingRequestDescriptor;
}

export interface HolderLine {
  running: number;
  ticketsInOrder: string[];
}

@Injectable()
export class WaitingLines {
  private readonly redis: Redis;

  constructor(connection: RedisConnection) {
    this.redis = connection.client;
  }

  async countWaiters(): Promise<number> {
    const count = await this.redis.eval(
      COUNT_SCRIPT,
      COUNT_SCRIPT_KEY_COUNT,
      WAITING_REQUEST_LEASES_KEY,
    );
    return Number(count);
  }

  async describedWaiters(): Promise<DescribedWaiter[]> {
    const reply = await this.redis.eval(
      DESCRIPTIONS_SCRIPT,
      DESCRIPTIONS_SCRIPT_KEY_COUNT,
      WAITING_REQUESTS_KEY,
      WAITING_REQUEST_LEASES_KEY,
    );
    const flat = stringsOf(reply);
    const waiters: DescribedWaiter[] = [];
    for (let index = 0; index < flat.length; index += 2) {
      const parsed = waitingRequestDescriptorSchema.safeParse(parseJson(flat[index + 1]));
      if (parsed.success) {
        waiters.push({ ticket: flat[index], descriptor: parsed.data });
      }
    }
    return waiters;
  }

  async linesOf(holders: SlotHolderRef[]): Promise<Map<string, HolderLine>> {
    const lines = new Map<string, HolderLine>();
    if (holders.length === 0) {
      return lines;
    }
    const keys = holders.flatMap((holder) => {
      const { held, line, lineLeases } = slotKeysOf(holder);
      return [held, line, lineLeases];
    });
    const reply = await this.redis.eval(LINES_SCRIPT, keys.length, ...keys);
    const values = Array.isArray(reply) ? reply : [];
    holders.forEach((holder, index) => {
      lines.set(holderKeyOf(holder), {
        running: Number(values[index * 2]),
        ticketsInOrder: stringsOf(values[index * 2 + 1]),
      });
    });
    return lines;
  }
}

function stringsOf(reply: unknown): string[] {
  if (!Array.isArray(reply)) {
    return [];
  }
  return reply.filter((value): value is string => typeof value === 'string');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
