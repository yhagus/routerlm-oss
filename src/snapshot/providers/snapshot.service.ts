import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryBus } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import type { Env } from '@/config/schemas/env.schema';
import type { Database } from '@/db/schemas/relations';
import { runInBackground } from '@/libs/models/background-work';
import { publishPrivateUpstreamsAllowed } from '@/libs/models/private-upstreams-policy';
import { RedisConnection } from '@/redis/providers/redis-connection';
import { ShowPrivateUpstreamsQuery } from '@/settings/queries/impl/show-private-upstreams.query';
import { ShowTermsRiskProvidersQuery } from '@/settings/queries/impl/show-terms-risk-providers.query';
import { loadSnapshot, type SnapshotSettings } from '@/snapshot/models/load-snapshot';
import { EMPTY_SNAPSHOT, type Snapshot } from '@/snapshot/models/snapshot';

export const SNAPSHOT_CHANGED_CHANNEL = 'routerlm:snapshot-changed';

const RELOAD_INTERVAL_NAME = 'snapshot-reload';
const FIRST_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 5000;

@Injectable()
export class SnapshotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SnapshotService.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly instanceId = randomUUID();
  private snapshot: Snapshot = EMPTY_SNAPSHOT;
  private lastReload: Promise<unknown> = Promise.resolve();
  private retryTimer: NodeJS.Timeout | undefined;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    redis: RedisConnection,
    private readonly config: ConfigService<Env, true>,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly queryBus: QueryBus,
  ) {
    this.publisher = redis.client;
    this.subscriber = redis.createSubscriber();
  }

  get current(): Snapshot {
    return this.snapshot;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.reload();
    this.subscriber.on('message', (_channel: string, publisherId: string) => {
      if (publisherId !== this.instanceId) {
        runInBackground(this.reload());
      }
    });
    this.subscriber.on('ready', () => runInBackground(this.reload()));
    runInBackground(firstConnectionAttemptOf(this.subscriber));
    this.subscriber.subscribe(SNAPSHOT_CHANGED_CHANNEL).catch((error: unknown) => {
      this.logger.warn(`Not subscribed to snapshot changes: ${String(error)}`);
    });
    this.schedulerRegistry.addInterval(
      RELOAD_INTERVAL_NAME,
      setInterval(
        () => runInBackground(this.reload()),
        this.config.get('SNAPSHOT_RELOAD_INTERVAL_MS', { infer: true }),
      ),
    );
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer);
  }

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

  private retryReloadWithBackoff(delayMs: number): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      runInBackground(
        this.reload().then((isReloaded) => {
          if (!isReloaded) {
            this.retryReloadWithBackoff(Math.min(delayMs * 2, MAX_RETRY_DELAY_MS));
          }
        }),
      );
    }, delayMs);
  }

  private reload(): Promise<boolean> {
    const reloaded = this.lastReload.then(async () => {
      try {
        this.snapshot = await loadSnapshot(this.db, await this.readSettings());
        publishPrivateUpstreamsAllowed(this.snapshot.allowsPrivateUpstreams);
        return true;
      } catch (error) {
        this.logger.error(`Snapshot reload failed; keeping the previous one: ${String(error)}`);
        return false;
      }
    });
    this.lastReload = reloaded;
    return reloaded;
  }

  private async readSettings(): Promise<SnapshotSettings> {
    const [termsRiskProviders, privateUpstreams] = await Promise.all([
      this.queryBus.execute(new ShowTermsRiskProvidersQuery()),
      this.queryBus.execute(new ShowPrivateUpstreamsQuery()),
    ]);
    return {
      allowsTermsRiskProviders: termsRiskProviders.allowed,
      allowsPrivateUpstreams: privateUpstreams.allowed,
    };
  }
}

function firstConnectionAttemptOf(connection: Redis): Promise<void> {
  return new Promise((resolve) => {
    const settle = (): void => {
      connection.off('ready', settle);
      connection.off('error', settle);
      resolve();
    };
    connection.on('ready', settle);
    connection.on('error', settle);
  });
}
