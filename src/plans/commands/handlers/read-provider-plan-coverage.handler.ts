import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import {
  type PlanReaderName,
  type ProviderEndpoint,
  providerAccounts,
  providers,
  upstreamModels,
} from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { GetProviderAccountCredentialQuery } from '@/upstream/queries/impl/get-provider-account-credential.query';
import type { ListedPlanCoverage } from '@/plans/models/plan-reader';
import { PlanReaders } from '@/plans/providers/plan-readers';
import { ReadProviderPlanCoverageCommand } from '@/plans/commands/impl/read-provider-plan-coverage.command';

type CoverageOutcome =
  | { kind: 'read'; listing: ListedPlanCoverage[] }
  | { kind: 'failed'; error: string };

@CommandHandler(ReadProviderPlanCoverageCommand)
export class ReadProviderPlanCoverageHandler implements ICommandHandler<ReadProviderPlanCoverageCommand> {
  private readonly logger = new Logger(ReadProviderPlanCoverageHandler.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly readers: PlanReaders,
    private readonly queryBus: QueryBus,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ providerId }: ReadProviderPlanCoverageCommand): Promise<void> {
    const [provider] = await this.db
      .select({ planReader: providers.planReader, endpoints: providers.endpoints })
      .from(providers)
      .where(eq(providers.id, providerId));
    if (!provider || provider.planReader === null) {
      return;
    }
    const readingAccountId = await this.firstEnabledApiKeyAccountOf(providerId);
    if (readingAccountId === undefined) {
      return;
    }

    const outcome = await this.read(readingAccountId, provider.planReader, provider.endpoints);
    if (outcome.kind === 'failed') {
      this.logger.warn(`Plan Coverage reading of Provider ${providerId} failed: ${outcome.error}`);
      return;
    }
    const updatedCount = await this.store(providerId, outcome.listing);
    if (updatedCount > 0) {
      await this.snapshot.changed();
    }
  }

  private async firstEnabledApiKeyAccountOf(providerId: string): Promise<string | undefined> {
    const [account] = await this.db
      .select({ id: providerAccounts.id })
      .from(providerAccounts)
      .where(
        and(
          eq(providerAccounts.providerId, providerId),
          eq(providerAccounts.isEnabled, true),
          eq(providerAccounts.credentialKind, 'api-key'),
        ),
      )
      .orderBy(asc(providerAccounts.priority), asc(providerAccounts.createdAt))
      .limit(1);
    return account?.id;
  }

  private async read(
    providerAccountId: string,
    readerName: PlanReaderName,
    endpoints: ProviderEndpoint[],
  ): Promise<CoverageOutcome> {
    try {
      const credential = await this.queryBus.execute(
        new GetProviderAccountCredentialQuery(providerAccountId),
      );
      const listing = await this.readers.readerFor(readerName).readCoverage(credential, endpoints);
      return { kind: 'read', listing };
    } catch (error) {
      return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async store(providerId: string, listing: ListedPlanCoverage[]): Promise<number> {
    const checkedAt = new Date();
    return this.db.transaction(async (tx) => {
      let updatedCount = 0;
      for (const { upstreamModelId, planCoverage } of listing) {
        const updated = await tx
          .update(upstreamModels)
          .set({ planCoverage, planCoverageCheckedAt: checkedAt })
          .where(
            and(
              eq(upstreamModels.providerId, providerId),
              eq(upstreamModels.upstreamModelId, upstreamModelId),
            ),
          )
          .returning({ id: upstreamModels.id });
        updatedCount += updated.length;
      }
      return updatedCount;
    });
  }
}
