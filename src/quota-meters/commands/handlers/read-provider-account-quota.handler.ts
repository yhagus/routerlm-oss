import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler, QueryBus } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, type AnyColumn, eq, notInArray, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import {
  type ProviderEndpoint,
  type QuotaReaderName,
  providerAccounts,
  providers,
  quotaMeters,
} from "@/db/schemas/index.js";
import { EndProviderAccountExhaustedCommand } from "@/upstream/commands/impl/end-provider-account-exhausted.command.js";
import { MarkProviderAccountExhaustedCommand } from "@/upstream/commands/impl/mark-provider-account-exhausted.command.js";
import { GetProviderAccountCredentialQuery } from "@/upstream/queries/impl/get-provider-account-credential.query.js";
import { exhaustedStateOf } from "@/quota-meters/models/exhausted.js";
import {
  overwrittenQuotaMeterColumns,
  type ProviderAccountQuota,
  type QuotaMeterReading,
  recordQuotaError,
  selectQuotaMeters,
} from "@/quota-meters/models/quota-meter.js";
import { type QuotaReading, quotaReaderProviderOf } from "@/quota-meters/models/quota-reader.js";
import { selectUsageResets, type UsageReset } from "@/quota-meters/models/usage-reset.js";
import { QuotaReaders } from "@/quota-meters/providers/quota-readers.js";
import { ReadProviderAccountQuotaCommand } from "@/quota-meters/commands/impl/read-provider-account-quota.command.js";
import { RefreshUsageResetsCommand } from "@/quota-meters/commands/impl/refresh-usage-resets.command.js";

type ReadingOutcome = { kind: "read"; reading: QuotaReading } | { kind: "failed"; error: string };

function excludedValuesOf(columns: Record<string, AnyColumn>): Record<string, SQL> {
  return Object.fromEntries(
    Object.entries(columns).map(([name, column]) => [
      name,
      sql`excluded.${sql.identifier(column.name)}`,
    ]),
  );
}

@CommandHandler(ReadProviderAccountQuotaCommand)
export class ReadProviderAccountQuotaHandler implements ICommandHandler<ReadProviderAccountQuotaCommand> {
  private readonly logger = new Logger(ReadProviderAccountQuotaHandler.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly readers: QuotaReaders,
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({
    providerAccountId,
  }: ReadProviderAccountQuotaCommand): Promise<ProviderAccountQuota> {
    const [account] = await this.db
      .select({
        continueWhenExhausted: providerAccounts.continueWhenExhausted,
        quotaReader: providers.quotaReader,
        providerEndpoints: providers.endpoints,
        providerQuirks: providers.quirks,
      })
      .from(providerAccounts)
      .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
      .where(eq(providerAccounts.id, providerAccountId));
    if (!account) {
      throw new NotFoundException("Provider Account not found");
    }
    if (account.quotaReader === null) {
      throw new BadRequestException("The Provider of this Provider Account reports no quota");
    }

    const outcome = await this.read(providerAccountId, account.quotaReader, {
      endpoints: account.providerEndpoints,
      quirks: account.providerQuirks,
    });
    if (outcome.kind === "failed") {
      this.logger.warn(
        `Quota reading of Provider Account ${providerAccountId} failed: ${outcome.error}`,
      );
    }
    const checkedAt = new Date();
    await this.store(providerAccountId, outcome, checkedAt);
    if (outcome.kind === "read") {
      await this.applyExhausted(providerAccountId, outcome.reading.meters, {
        checkedAt,
        continueWhenExhausted: account.continueWhenExhausted,
      });
      await this.refreshUsageResetsOnNewCount(providerAccountId, outcome.reading.usageResetCount);
    }
    const hasUsageResets = this.readers.usageResetsOf(account.quotaReader) !== undefined;
    return this.quotaOf(providerAccountId, hasUsageResets);
  }

  private async refreshUsageResetsOnNewCount(
    providerAccountId: string,
    usageResetCount: number | null,
  ): Promise<void> {
    if (usageResetCount === null) {
      return;
    }
    const stored = await this.storedUsageResetsOf(providerAccountId);
    if (stored.length !== usageResetCount) {
      await this.commandBus.execute(new RefreshUsageResetsCommand(providerAccountId));
    }
  }

  private async applyExhausted(
    providerAccountId: string,
    meters: QuotaMeterReading[],
    { checkedAt, continueWhenExhausted }: { checkedAt: Date; continueWhenExhausted: boolean },
  ): Promise<void> {
    const state = exhaustedStateOf(meters, checkedAt);
    if (!state.isExhausted) {
      await this.commandBus.execute(new EndProviderAccountExhaustedCommand(providerAccountId));
      return;
    }
    if (!continueWhenExhausted) {
      await this.commandBus.execute(
        new MarkProviderAccountExhaustedCommand(providerAccountId, state.until),
      );
    }
  }

  private async read(
    providerAccountId: string,
    readerName: QuotaReaderName,
    provider: { endpoints: ProviderEndpoint[]; quirks: unknown },
  ): Promise<ReadingOutcome> {
    try {
      const readerProvider = quotaReaderProviderOf(provider);
      const credential = await this.queryBus.execute(
        new GetProviderAccountCredentialQuery(providerAccountId),
      );
      const reading = await this.readers.readerFor(readerName).read(credential, readerProvider);
      return { kind: "read", reading };
    } catch (error) {
      return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async store(
    providerAccountId: string,
    outcome: ReadingOutcome,
    checkedAt: Date,
  ): Promise<void> {
    if (outcome.kind === "failed") {
      await recordQuotaError(this.db, providerAccountId, { error: outcome.error, checkedAt });
      return;
    }
    await this.db.transaction(async (tx) => {
      const { meters } = outcome.reading;
      const readKeys = meters.map((meter) => meter.key);
      await tx
        .delete(quotaMeters)
        .where(
          readKeys.length === 0
            ? eq(quotaMeters.providerAccountId, providerAccountId)
            : and(
                eq(quotaMeters.providerAccountId, providerAccountId),
                notInArray(quotaMeters.key, readKeys),
              ),
        );
      if (meters.length > 0) {
        await tx
          .insert(quotaMeters)
          .values(meters.map((meter) => ({ ...meter, providerAccountId, observedAt: checkedAt })))
          .onConflictDoUpdate({
            target: [quotaMeters.providerAccountId, quotaMeters.key],
            set: excludedValuesOf(overwrittenQuotaMeterColumns),
          });
      }
      await tx
        .update(providerAccounts)
        .set({ quotaCheckedAt: checkedAt, quotaError: null })
        .where(eq(providerAccounts.id, providerAccountId));
    });
  }

  private async quotaOf(
    providerAccountId: string,
    hasUsageResets: boolean,
  ): Promise<ProviderAccountQuota> {
    const [status] = await this.db
      .select({
        quotaCheckedAt: providerAccounts.quotaCheckedAt,
        quotaError: providerAccounts.quotaError,
      })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId));
    if (!status) {
      throw new NotFoundException("Provider Account not found");
    }
    const meters = await selectQuotaMeters(this.db, [providerAccountId]);
    return {
      ...status,
      quotaMeters: meters.get(providerAccountId) ?? [],
      usageResets: hasUsageResets ? await this.storedUsageResetsOf(providerAccountId) : null,
    };
  }

  private async storedUsageResetsOf(providerAccountId: string): Promise<UsageReset[]> {
    const resets = await selectUsageResets(this.db, [providerAccountId]);
    return resets.get(providerAccountId) ?? [];
  }
}
