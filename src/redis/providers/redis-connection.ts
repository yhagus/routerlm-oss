import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis, type RedisOptions } from "ioredis";
import type { Env } from "@/config/schemas/env.schema.js";

const COMMAND_TIMEOUT_MS = 250;

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

  createSubscriber(): Redis {
    const subscriber = this.connection("subscriber", {});
    this.subscribers.push(subscriber);
    return subscriber;
  }

  private connection(role: string, options: RedisOptions): Redis {
    const connection = new Redis(this.url, { ...options, lazyConnect: true });
    connection.on("error", (error: Error) => this.logger.warn(`Redis (${role}): ${error.message}`));
    return connection;
  }
}
