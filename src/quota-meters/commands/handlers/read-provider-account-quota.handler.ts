import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler, QueryBus } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, type AnyColumn, eq, notInArray, type SQL, sql } from "drizzle-orm";
import { chatEndpointOf, providerQuirksSchema } from "@/catalog/schemas/catalog.schema.js";
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
  selectQuotaMeters,
} from "@/quota-meters/models/quota-meter.js";
import type { QuotaReading } from "@/quota-meters/models/quota-reader.js";
import { selectUsageResets } from "@/quota-meters/models/usage-reset.js";
import { QuotaReaders } from "@/quota-meters/providers/quota-readers.js";
import { ReadProviderAccountQuotaCommand } from "@/quota-meters/commands/impl/read-provider-account-quota.command.js";
import { RefreshUsageResetsCommand } from "@/quota-meters/commands/impl/refresh-usage-resets.command.js";
import { ListUsageResetsQuery } from "@/quota-meters/queries/impl/list-usage-resets.query.js";

type ReadingOutcome = { kind: "read"; reading: QuotaReading } | { kind: "failed"; error: string };

/** An upsert's SET that writes, into each of `columns`, the value the upsert tried to insert. */
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
    return this.quotaOf(providerAccountId);
  }

  /**
   * The list of Usage Resets is fetched only when the reading's count differs
   * from the stored unexpired resets (ADR 0041); a failed fetch keeps them.
   */
  private async refreshUsageResetsOnNewCount(
    providerAccountId: string,
    usageResetCount: number | null,
  ): Promise<void> {
    if (usageResetCount === null) {
      return;
    }
    const stored = await selectUsageResets(this.db, [providerAccountId]);
    if ((stored.get(providerAccountId) ?? []).length !== usageResetCount) {
      await this.commandBus.execute(new RefreshUsageResetsCommand(providerAccountId));
    }
  }

  /**
   * Routing never reads Quota Meters, so a reading tells upstream whether the
   * account is Exhausted. A failed reading changes nothing.
   */
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
    // The operator lets the Provider bill the excess; an Exhausted state set
    // by a refused Attempt still runs its course.
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
      const chatEndpoint = chatEndpointOf(provider.endpoints);
      if (chatEndpoint === undefined) {
        throw new Error("The Provider has no chat endpoint to read the quota from");
      }
      const { quotaBaseUrl } = providerQuirksSchema.parse(provider.quirks);
      // An OAuth Login about to run out is refreshed first, as before an Attempt.
      const credential = await this.queryBus.execute(
        new GetProviderAccountCredentialQuery(providerAccountId),
      );
      const reading = await this.readers
        .readerFor(readerName)
        .read(credential, { baseUrl: chatEndpoint.baseUrl, quotaBaseUrl });
      return { kind: "read", reading };
    } catch (error) {
      return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** A successful reading replaces every meter of the account; a failed one leaves them as they were. */
  private async store(
    providerAccountId: string,
    outcome: ReadingOutcome,
    checkedAt: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (outcome.kind === "failed") {
        await tx
          .update(providerAccounts)
          .set({ quotaCheckedAt: checkedAt, quotaError: outcome.error })
          .where(eq(providerAccounts.id, providerAccountId));
        return;
      }

      const { meters } = outcome.reading;
      const readKeys = meters.map((meter) => meter.key);
      // A meter the Provider no longer reports would otherwise keep its last value forever.
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

  private async quotaOf(providerAccountId: string): Promise<ProviderAccountQuota> {
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
    const resets = await this.queryBus.execute(new ListUsageResetsQuery([providerAccountId]));
    return {
      ...status,
      quotaMeters: meters.get(providerAccountId) ?? [],
      usageResets: resets.get(providerAccountId) ?? null,
    };
  }
}
