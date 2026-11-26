import { PasswordHasher } from '@nestjs/authentication';
import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { SeedCatalogCommand } from '@/catalog/commands/impl/seed-catalog.command';
import type { Database } from '@/db/schemas/relations';
import {
  apiKeys,
  attempts,
  errorCaptures,
  models,
  providerAccounts,
  providers,
  quotaMeters,
  routes,
  sessions,
  upstreamModels,
  usageLogs,
  users,
} from '@/db/schemas';
import { SECOND_MS } from '@/libs/models/duration';
import { storedKey } from '@/upstream/models/provider-account';
import { ProviderKeyCipher } from '@/upstream/providers/provider-key-cipher';
import { normalizeEmail } from '@/users/models/user';
import {
  DEMO_CALLERS,
  DEMO_MODELS,
  DEMO_PROVIDER_ACCOUNTS,
  DEMO_QUOTA_METERS,
  DEMO_USER,
  type DemoModelName,
} from '@/demo/data/demo-fixtures';
import {
  generateDemoTraffic,
  type TrafficCaller,
  type TrafficModel,
  type TrafficProviderAccount,
} from '@/demo/models/demo-traffic';
import { DemoApiKeyGenerator } from '@/demo/providers/demo-api-key-generator';
import { SeedDemoCommand, type SeedDemoResult } from '@/demo/commands/impl/seed-demo.command';
import { API_KEY_CIPHER_PURPOSE } from '@/api-keys/models/api-key';

const APP_TABLES: PgTable[] = [
  errorCaptures,
  attempts,
  usageLogs,
  quotaMeters,
  apiKeys,
  sessions,
  users,
  routes,
  models,
  providerAccounts,
  upstreamModels,
  providers,
];

const INSERT_BATCH_SIZE = 500;

type AccountsBySlug = ReadonlyMap<string, TrafficProviderAccount[]>;

@CommandHandler(SeedDemoCommand)
export class SeedDemoHandler implements ICommandHandler<SeedDemoCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly commandBus: CommandBus,
    private readonly passwordHasher: PasswordHasher,
    private readonly keyCipher: ProviderKeyCipher,
    private readonly apiKeyGenerator: DemoApiKeyGenerator,
  ) {}

  async execute({ catalog, now }: SeedDemoCommand): Promise<SeedDemoResult> {
    await this.db.execute(sql`truncate table ${sql.join(APP_TABLES, sql`, `)} cascade`);
    await this.commandBus.execute(new SeedCatalogCommand(catalog));
    const userId = await this.createUser();

    const accountsBySlug = await this.createProviderAccounts(now);
    await this.createQuotaMeters(accountsBySlug, now);
    const trafficModels = await this.createModels(accountsBySlug);
    const callers = await this.createCallers(userId);

    const traffic = generateDemoTraffic(now, trafficModels, callers);
    for (const batch of batchesOf(traffic.usageLogs)) {
      await this.db.insert(usageLogs).values(batch);
    }
    for (const batch of batchesOf(traffic.attempts)) {
      await this.db.insert(attempts).values(batch);
    }
    if (traffic.errorCaptures.length > 0) {
      await this.db.insert(errorCaptures).values(traffic.errorCaptures);
    }
    return {
      usageLogCount: traffic.usageLogs.length,
      errorCaptureCount: traffic.errorCaptures.length,
    };
  }

  private async createUser(): Promise<string> {
    const [created] = await this.db
      .insert(users)
      .values({
        email: normalizeEmail(DEMO_USER.email),
        passwordHash: await this.passwordHasher.hash(DEMO_USER.password),
      })
      .returning({ id: users.id });
    return created.id;
  }

  private async createProviderAccounts(now: Date): Promise<AccountsBySlug> {
    const providerIds = await this.providerIdsBySlug();
    const quotaSlugs = new Set(DEMO_QUOTA_METERS.map((meter) => meter.providerSlug));
    const accountsBySlug = new Map<string, TrafficProviderAccount[]>();
    for (const account of DEMO_PROVIDER_ACCOUNTS) {
      const [created] = await this.db
        .insert(providerAccounts)
        .values({
          providerId: requireValue(providerIds, account.providerSlug, 'Provider'),
          name: account.name,
          priority: account.priority,
          ...storedKey(this.keyCipher, account.key),
          quotaCheckedAt: quotaSlugs.has(account.providerSlug) ? now : null,
        })
        .returning({ id: providerAccounts.id, name: providerAccounts.name });
      const siblings = accountsBySlug.get(account.providerSlug) ?? [];
      accountsBySlug.set(account.providerSlug, [...siblings, created]);
    }
    return accountsBySlug;
  }

  private async createQuotaMeters(accountsBySlug: AccountsBySlug, now: Date): Promise<void> {
    await this.db.insert(quotaMeters).values(
      DEMO_QUOTA_METERS.flatMap((meter) =>
        requireValue(accountsBySlug, meter.providerSlug, 'Provider Account').map(
          ({ id: providerAccountId }) => ({
            providerAccountId,
            key: meter.key,
            label: meter.label,
            unit: meter.unit,
            used: meter.used,
            limit: meter.limit,
            remainingPercent: (100 * (meter.limit - meter.used)) / meter.limit,
            windowSeconds: meter.windowSeconds,
            resetsAt: new Date(now.getTime() + meter.resetsInSeconds * SECOND_MS),
            observedAt: now,
            raw: { demo: true },
          }),
        ),
      ),
    );
  }

  private async createModels(
    accountsBySlug: AccountsBySlug,
  ): Promise<Map<DemoModelName, TrafficModel>> {
    const catalogModels = await this.db
      .select({
        id: upstreamModels.id,
        providerSlug: providers.slug,
        providerName: providers.name,
        upstreamModelId: upstreamModels.upstreamModelId,
        inputPrice: upstreamModels.inputPrice,
        outputPrice: upstreamModels.outputPrice,
        cacheReadPrice: upstreamModels.cacheReadPrice,
        cacheWritePrice: upstreamModels.cacheWritePrice,
      })
      .from(upstreamModels)
      .innerJoin(providers, eq(upstreamModels.providerId, providers.id));
    const upstreamModelsByKey = new Map(
      catalogModels.map((model) => [`${model.providerSlug}/${model.upstreamModelId}`, model]),
    );

    const trafficModels = new Map<DemoModelName, TrafficModel>();
    for (const demoModel of DEMO_MODELS) {
      const [model] = await this.db
        .insert(models)
        .values({ name: demoModel.name })
        .returning({ id: models.id });
      const trafficRoutes = [];
      for (const [priority, route] of demoModel.routes.entries()) {
        const upstreamModel = requireValue(
          upstreamModelsByKey,
          `${route.providerSlug}/${route.upstreamModelId}`,
          'Catalog Upstream Model',
        );
        const [created] = await this.db
          .insert(routes)
          .values({ modelId: model.id, upstreamModelId: upstreamModel.id, priority })
          .returning({ id: routes.id });
        trafficRoutes.push({
          routeId: created.id,
          upstreamModelRowId: upstreamModel.id,
          upstreamModelName: upstreamModel.upstreamModelId,
          providerSlug: route.providerSlug,
          providerName: upstreamModel.providerName,
          prices: upstreamModel,
          providerAccounts: requireValue(accountsBySlug, route.providerSlug, 'Provider Account'),
        });
      }
      trafficModels.set(demoModel.name, {
        modelId: model.id,
        modelName: demoModel.name,
        profile: demoModel.profile,
        routes: trafficRoutes,
      });
    }
    return trafficModels;
  }

  private async createCallers(userId: string): Promise<TrafficCaller[]> {
    const callers: TrafficCaller[] = [];
    for (const caller of DEMO_CALLERS) {
      if (caller.apiKeyName === null) {
        callers.push({ source: { kind: 'playground', userId }, caller });
        continue;
      }
      const { key, id: keyId, hash } = this.apiKeyGenerator.generate();
      const [created] = await this.db
        .insert(apiKeys)
        .values({
          name: caller.apiKeyName,
          keyId,
          hash,
          encryptedKey: this.keyCipher.encrypt(key, API_KEY_CIPHER_PURPOSE),
          createdById: userId,
        })
        .returning({ id: apiKeys.id });
      callers.push({
        source: { kind: 'api-key', apiKeyId: created.id, apiKeyName: caller.apiKeyName },
        caller,
      });
    }
    return callers;
  }

  private async providerIdsBySlug(): Promise<Map<string, string>> {
    const rows = await this.db.select({ id: providers.id, slug: providers.slug }).from(providers);
    return new Map(rows.map((row) => [row.slug, row.id]));
  }
}

function batchesOf<T>(rows: T[]): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
    batches.push(rows.slice(start, start + INSERT_BATCH_SIZE));
  }
  return batches;
}

function requireValue<T>(map: ReadonlyMap<string, T>, key: string, what: string): T {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Demo seed: no ${what} "${key}"; update src/demo/data/demo-fixtures.ts`);
  }
  return value;
}
