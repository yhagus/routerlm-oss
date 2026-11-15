import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, type AnyColumn, eq, notInArray, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import {
  type QuotaReaderName,
  providerAccounts,
  providers,
  quotaMeters,
} from "@/db/schemas/index.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import {
  type ProviderAccountQuota,
  type QuotaMeterReading,
  selectQuotaMeters,
} from "../../models/quota-meter.js";
import { QuotaReaders } from "../../providers/quota-readers.js";
import { ReadProviderAccountQuotaCommand } from "../impl/read-provider-account-quota.command.js";

type ReadingOutcome =
  | { kind: "read"; meters: QuotaMeterReading[] }
  | { kind: "failed"; error: string };

/** The value an upsert tried to insert into `column`. */
function excluded(column: AnyColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}

@CommandHandler(ReadProviderAccountQuotaCommand)
export class ReadProviderAccountQuotaHandler implements ICommandHandler<ReadProviderAccountQuotaCommand> {
  private readonly logger = new Logger(ReadProviderAccountQuotaHandler.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly keyCipher: ProviderKeyCipher,
    private readonly readers: QuotaReaders,
  ) {}

  async execute({
    providerAccountId,
  }: ReadProviderAccountQuotaCommand): Promise<ProviderAccountQuota> {
    const [account] = await this.db
      .select({ encryptedKey: providerAccounts.encryptedKey, quotaReader: providers.quotaReader })
      .from(providerAccounts)
      .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
      .where(eq(providerAccounts.id, providerAccountId));
    if (!account) {
      throw new NotFoundException("Provider Account not found");
    }
    if (account.quotaReader === null) {
      throw new BadRequestException("The Provider of this Provider Account reports no quota");
    }

    const outcome = await this.read(account.quotaReader, account.encryptedKey);
    if (outcome.kind === "failed") {
      this.logger.warn(
        `Quota reading of Provider Account ${providerAccountId} failed: ${outcome.error}`,
      );
    }
    await this.store(providerAccountId, outcome, new Date());
    return this.quotaOf(providerAccountId);
  }

  private async read(readerName: QuotaReaderName, encryptedKey: string): Promise<ReadingOutcome> {
    try {
      const key = this.keyCipher.decrypt(encryptedKey);
      const meters = await this.readers.readerFor(readerName).read(key);
      return { kind: "read", meters };
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

      const readKeys = outcome.meters.map((meter) => meter.key);
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
      if (outcome.meters.length > 0) {
        await tx
          .insert(quotaMeters)
          .values(
            outcome.meters.map((meter) => ({ ...meter, providerAccountId, observedAt: checkedAt })),
          )
          .onConflictDoUpdate({
            target: [quotaMeters.providerAccountId, quotaMeters.key],
            set: {
              label: excluded(quotaMeters.label),
              unit: excluded(quotaMeters.unit),
              used: excluded(quotaMeters.used),
              limit: excluded(quotaMeters.limit),
              remainingPercent: excluded(quotaMeters.remainingPercent),
              isUnlimited: excluded(quotaMeters.isUnlimited),
              windowSeconds: excluded(quotaMeters.windowSeconds),
              resetsAt: excluded(quotaMeters.resetsAt),
              scope: excluded(quotaMeters.scope),
              observedAt: excluded(quotaMeters.observedAt),
              raw: excluded(quotaMeters.raw),
            },
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
    return { ...status, quotaMeters: meters.get(providerAccountId) ?? [] };
  }
}
