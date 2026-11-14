import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis, type RedisOptions } from "ioredis";
import type { Env } from "@/config/schemas/env.schema.js";

// The inference path waits at most this long for Redis; past it, Redis state
// is treated as unknown rather than holding the request.
const COMMAND_TIMEOUT_MS = 250;

/**
 * The backend's Redis connections, outside BullMQ: one shared connection for
 * commands (Cooldown state, snapshot change notices) and one per subscriber.
 * Redis is optional to every caller, so commands fail at once while it is
 * unreachable instead of queueing, and ioredis reconnects in the background.
 */
@Injectable()
export class RedisConnection implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RedisConnection.name);
  private readonly url: string;
  readonly client: Redis;
  private readonly subscribers: Redis[] = [];

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get("REDIS_URL", { infer: true });
    this.client = this.connection("commands", {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: COMMAND_TIMEOUT_MS,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      this.logger.warn(`Redis is not reachable yet: ${String(error)}`);
    }
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
    for (const subscriber of this.subscribers) {
      subscriber.disconnect();
    }
  }

  /**
   * A connection of its own for SUBSCRIBE, which takes a connection over. It
   * connects on its first command and resubscribes after every reconnect.
   */
  createSubscriber(): Redis {
    const subscriber = this.connection("subscriber", {});
    this.subscribers.push(subscriber);
    return subscriber;
  }

  private connection(role: string, options: RedisOptions): Redis {
    const connection = new Redis(this.url, { ...options, lazyConnect: true });
    // Without a listener, ioredis reports every failed reconnect as an unhandled error.
    connection.on("error", (error: Error) => this.logger.warn(`Redis (${role}): ${error.message}`));
    return connection;
  }
}
