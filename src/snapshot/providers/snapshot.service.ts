import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDrizzle } from "@nestjs/drizzle";
import { SchedulerRegistry } from "@nestjs/schedule";
import type { Redis } from "ioredis";
import type { Env } from "@/config/schemas/env.schema.js";
import type { Database } from "@/db/schemas/relations.js";
import { publishPrivateUpstreamsAllowed } from "@/libs/models/private-upstreams-policy.js";
import { RedisConnection } from "@/redis/providers/redis-connection.js";
import { loadSnapshot } from "@/snapshot/models/load-snapshot.js";
import { EMPTY_SNAPSHOT, type Snapshot } from "@/snapshot/models/snapshot.js";

/** Every backend instance listens here and reloads its snapshot on another instance's message. */
export const SNAPSHOT_CHANGED_CHANNEL = "routerlm:snapshot-changed";

const RELOAD_INTERVAL_NAME = "snapshot-reload";
const FIRST_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 5000;

/**
 * Holds the in-memory snapshot the inference path reads (API Keys, Models,
 * Routes, Upstream Models, Providers, Provider Accounts) and keeps it fresh:
 * a dashboard write calls `changed()`, which reloads this instance and tells
 * the others through Redis pub/sub. Every instance also reloads on a fixed
 * interval, which bounds how long a lost message or a failed reload can leave
 * a revoked API Key or a disabled Provider in use (ADR 0020). Each reload also
 * publishes the Allow private upstreams Setting to the synchronous Provider URL
 * checks of this process.
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
  private lastReload: Promise<unknown> = Promise.resolve();
  private retryTimer: NodeJS.Timeout | undefined;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    redis: RedisConnection,
    private readonly config: ConfigService<Env, true>,
    private readonly schedulerRegistry: SchedulerRegistry,
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
    this.schedulerRegistry.addInterval(
      RELOAD_INTERVAL_NAME,
      setInterval(
        () => void this.reload(),
        this.config.get("SNAPSHOT_RELOAD_INTERVAL_MS", { infer: true }),
      ),
    );
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer);
  }

  /** Call after a dashboard write commits. Never throws: the write already happened. */
  async changed(): Promise<void> {
    const isReloaded = await this.reload();
    if (!isReloaded) {
      this.retryReloadWithBackoff(FIRST_RETRY_DELAY_MS);
    }
    try {
      await this.publisher.publish(SNAPSHOT_CHANGED_CHANNEL, this.instanceId);
    } catch (error) {
      this.logger.warn(`Other instances were not told about a change: ${String(error)}`);
    }
  }

  /** Retries in the background, so the write that triggered it is not held up. */
  private retryReloadWithBackoff(delayMs: number): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      void this.reload().then((isReloaded) => {
        if (!isReloaded) {
          this.retryReloadWithBackoff(Math.min(delayMs * 2, MAX_RETRY_DELAY_MS));
        }
      });
    }, delayMs);
  }

  /** Resolves to whether the reload succeeded; a failed one keeps the previous snapshot. */
  private reload(): Promise<boolean> {
    const reloaded = this.lastReload.then(async () => {
      try {
        this.snapshot = await loadSnapshot(this.db);
        publishPrivateUpstreamsAllowed(this.snapshot.allowsPrivateUpstreams);
        return true;
      } catch (error) {
        // Allow private upstreams keeps its last value, like the rest of the
        // snapshot: a database blip must not cut off working LAN upstreams.
        this.logger.error(`Snapshot reload failed; keeping the previous one: ${String(error)}`);
        return false;
      }
    });
    this.lastReload = reloaded;
    return reloaded;
  }
}
