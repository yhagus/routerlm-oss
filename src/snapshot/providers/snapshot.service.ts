import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Redis } from "ioredis";
import type { Database } from "../../db/schemas/relations.js";
import { RedisConnection } from "../../redis/providers/redis-connection.js";
import { loadSnapshot } from "../models/load-snapshot.js";
import { EMPTY_SNAPSHOT, type Snapshot } from "../models/snapshot.js";

/** Every backend instance listens here and reloads its snapshot on another instance's message. */
export const SNAPSHOT_CHANGED_CHANNEL = "routerlm:snapshot-changed";

/**
 * Holds the in-memory snapshot the inference path reads (API Keys, Models,
 * Routes, Upstream Models, Providers, Provider Accounts) and keeps it fresh:
 * a dashboard write calls `changed()`, which reloads this instance and tells
 * the others through Redis pub/sub.
 */
@Injectable()
export class SnapshotService implements OnApplicationBootstrap {
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
    redis: RedisConnection,
  ) {
    // A publish fails at once while Redis is down instead of holding the
    // dashboard write that triggered it.
    this.publisher = redis.client;
    this.subscriber = redis.createSubscriber();
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
}
