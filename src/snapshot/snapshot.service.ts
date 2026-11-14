import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDrizzle } from "@nestjs/drizzle";
import { Redis } from "ioredis";
import type { Env } from "../config/env.schema.js";
import type { Database } from "../db/relations.js";
import { loadSnapshot } from "./load-snapshot.js";
import { EMPTY_SNAPSHOT, type Snapshot } from "./snapshot.js";

/** Every backend instance listens here and reloads its snapshot on another instance's message. */
export const SNAPSHOT_CHANGED_CHANNEL = "routerlm:snapshot-changed";

// As in QueueModule: a publish gives up after about a second while Redis is
// down, instead of holding the dashboard write that triggered it.
const PUBLISH_RECONNECT_DELAY_MS = 1000;

/**
 * Holds the in-memory snapshot the inference path reads (API Keys, Models,
 * Routes, Upstream Models, Providers, Provider Accounts) and keeps it fresh:
 * a dashboard write calls `changed()`, which reloads this instance and tells
 * the others through Redis pub/sub.
 */
@Injectable()
export class SnapshotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SnapshotService.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  // Tells this instance's own messages apart: it reloaded before publishing.
  private readonly instanceId = randomUUID();
  private snapshot: Snapshot = EMPTY_SNAPSHOT;
  // Reloads run one after another, so the last one always reads the latest writes.
  private lastReload: Promise<void> = Promise.resolve();

  constructor(
    @InjectDrizzle() private readonly db: Database,
    config: ConfigService<Env, true>,
  ) {
    const redisUrl = config.get("REDIS_URL", { infer: true });
    this.publisher = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => PUBLISH_RECONNECT_DELAY_MS,
      lazyConnect: true,
    });
    this.subscriber = new Redis(redisUrl, { lazyConnect: true });
    // Without listeners, ioredis reports every failed reconnect as an unhandled error.
    this.publisher.on("error", (error: Error) => this.logRedisError("publish", error));
    this.subscriber.on("error", (error: Error) => this.logRedisError("subscribe", error));
  }

  get current(): Snapshot {
    return this.snapshot;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.reload();
    this.subscriber.on("message", (_channel: string, publisherId: string) => {
      if (publisherId !== this.instanceId) {
        void this.reload();
      }
    });
    // Messages sent while disconnected are lost, so catch up on every (re)connect.
    this.subscriber.on("ready", () => void this.reload());
    this.subscriber.subscribe(SNAPSHOT_CHANGED_CHANNEL).catch((error: unknown) => {
      this.logger.warn(`Not subscribed to snapshot changes: ${String(error)}`);
    });
  }

  onApplicationShutdown(): void {
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }

  /** Call after a dashboard write commits. Never throws: the write already happened. */
  async changed(): Promise<void> {
    await this.reload();
    try {
      await this.publisher.publish(SNAPSHOT_CHANGED_CHANNEL, this.instanceId);
    } catch (error) {
      this.logger.warn(`Other instances were not told about a change: ${String(error)}`);
    }
  }

  private reload(): Promise<void> {
    this.lastReload = this.lastReload.then(async () => {
      try {
        this.snapshot = await loadSnapshot(this.db);
      } catch (error) {
        this.logger.error(`Snapshot reload failed; keeping the previous one: ${String(error)}`);
      }
    });
    return this.lastReload;
  }

  private logRedisError(role: string, error: Error): void {
    this.logger.warn(`Redis (snapshot ${role}): ${error.message}`);
  }
}
