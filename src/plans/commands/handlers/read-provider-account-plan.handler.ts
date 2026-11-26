import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler, QueryBus } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import {
  type PlanReaderName,
  type ProviderEndpoint,
  providerAccounts,
  providers,
} from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { type ProviderAccount, providerAccountColumns } from '@/upstream/models/provider-account';
import { GetProviderAccountCredentialQuery } from '@/upstream/queries/impl/get-provider-account-credential.query';
import { PlanReaders } from '@/plans/providers/plan-readers';
import { ReadProviderAccountPlanCommand } from '@/plans/commands/impl/read-provider-account-plan.command';

type PlanOutcome = { kind: 'read'; plan: string | null } | { kind: 'failed'; error: string };

@CommandHandler(ReadProviderAccountPlanCommand)
export class ReadProviderAccountPlanHandler implements ICommandHandler<ReadProviderAccountPlanCommand> {
  private readonly logger = new Logger(ReadProviderAccountPlanHandler.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly readers: PlanReaders,
    private readonly queryBus: QueryBus,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ providerAccountId }: ReadProviderAccountPlanCommand): Promise<ProviderAccount> {
    const [account] = await this.db
      .select({ planReader: providers.planReader, providerEndpoints: providers.endpoints })
      .from(providerAccounts)
      .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
      .where(eq(providerAccounts.id, providerAccountId));
    if (!account) {
      throw new NotFoundException('Provider Account not found');
    }
    if (account.planReader === null) {
      throw new BadRequestException('The Provider of this Provider Account reports no Plan');
    }

    const outcome = await this.read(
      providerAccountId,
      account.planReader,
      account.providerEndpoints,
    );
    if (outcome.kind === 'failed') {
      this.logger.warn(
        `Plan reading of Provider Account ${providerAccountId} failed: ${outcome.error}`,
      );
      return this.accountOf(providerAccountId);
    }
    await this.db
      .update(providerAccounts)
      .set({ plan: outcome.plan, planCheckedAt: new Date() })
      .where(eq(providerAccounts.id, providerAccountId));
    await this.snapshot.changed();
    return this.accountOf(providerAccountId);
  }

  private async read(
    providerAccountId: string,
    readerName: PlanReaderName,
    endpoints: ProviderEndpoint[],
  ): Promise<PlanOutcome> {
    try {
      const credential = await this.queryBus.execute(
        new GetProviderAccountCredentialQuery(providerAccountId),
      );
      const plan = await this.readers.readerFor(readerName).readPlan(credential, endpoints);
      return { kind: 'read', plan };
    } catch (error) {
      return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async accountOf(providerAccountId: string): Promise<ProviderAccount> {
    const [account] = await this.db
      .select(providerAccountColumns)
      .from(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId));
    if (!account) {
      throw new NotFoundException('Provider Account not found');
    }
    return account;
  }
}
