import { Logger } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq, inArray } from 'drizzle-orm';
import { apiKeys, integrations, providerAccounts, providers, users } from '@/db/schemas';
import type { Database } from '@/db/schemas/relations';
import type { SlotHolderRef } from '@/inference/models/concurrency-slot';
import {
  distinctHoldersOf,
  type WaitingDirectory,
  waitingLinesOf,
  waitingRequestsOf,
} from '@/waiting-requests/models/waiting-request-rows';
import type { WaitingRequestList } from '@/waiting-requests/models/waiting-requests';
import {
  type DescribedWaiter,
  type HolderLine,
  WaitingLines,
} from '@/waiting-requests/providers/waiting-lines';
import { ListWaitingRequestsQuery } from '@/waiting-requests/queries/impl/list-waiting-requests.query';

interface WaitingState {
  waiters: DescribedWaiter[];
  holders: SlotHolderRef[];
  lines: Map<string, HolderLine>;
}

const UNAVAILABLE: WaitingRequestList = { available: false, lines: [], requests: [] };

@QueryHandler(ListWaitingRequestsQuery)
export class ListWaitingRequestsHandler implements IQueryHandler<ListWaitingRequestsQuery> {
  private readonly logger = new Logger(ListWaitingRequestsHandler.name);

  constructor(
    private readonly waitingLines: WaitingLines,
    @InjectDrizzle() private readonly db: Database,
  ) {}

  async execute(): Promise<WaitingRequestList> {
    const state = await this.waitingState();
    if (!state) {
      return UNAVAILABLE;
    }
    const { waiters, holders, lines } = state;
    const directory = await this.directoryOf(waiters, holders);
    return {
      available: true,
      lines: waitingLinesOf(holders, lines, directory),
      requests: waitingRequestsOf(waiters, lines, directory, Date.now()),
    };
  }

  private async waitingState(): Promise<WaitingState | null> {
    try {
      const waiters = await this.waitingLines.describedWaiters();
      const holders = distinctHoldersOf(waiters);
      return { waiters, holders, lines: await this.waitingLines.linesOf(holders) };
    } catch (error) {
      this.logger.warn(`Waiting Requests not read: ${String(error)}`);
      return null;
    }
  }

  private async directoryOf(
    waiters: DescribedWaiter[],
    holders: SlotHolderRef[],
  ): Promise<WaitingDirectory> {
    const apiKeyIds = new Set<string>();
    const providerAccountIds = new Set<string>();
    const integrationIds = new Set<string>();
    const userIds = new Set<string>();
    for (const holder of holders) {
      (holder.kind === 'api-key' ? apiKeyIds : providerAccountIds).add(holder.id);
    }
    for (const { descriptor } of waiters) {
      const { caller } = descriptor;
      if (caller.kind === 'api-key') {
        apiKeyIds.add(caller.apiKeyId);
        if (caller.customer) {
          integrationIds.add(caller.customer.integrationId);
        }
      }
      if (caller.kind === 'playground') {
        userIds.add(caller.userId);
      }
    }
    const [apiKeyRows, accountRows, integrationRows, userRows] = await Promise.all([
      this.db
        .select({ id: apiKeys.id, name: apiKeys.name, concurrencyLimit: apiKeys.concurrencyLimit })
        .from(apiKeys)
        .where(inArray(apiKeys.id, [...apiKeyIds])),
      this.db
        .select({
          id: providerAccounts.id,
          name: providerAccounts.name,
          providerName: providers.name,
          concurrencyLimit: providerAccounts.concurrencyLimit,
        })
        .from(providerAccounts)
        .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
        .where(inArray(providerAccounts.id, [...providerAccountIds])),
      this.db
        .select({ id: integrations.id, name: integrations.name })
        .from(integrations)
        .where(inArray(integrations.id, [...integrationIds])),
      this.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.id, [...userIds])),
    ]);
    return {
      apiKeys: new Map(apiKeyRows.map(({ id, ...apiKey }) => [id, apiKey])),
      providerAccounts: new Map(accountRows.map(({ id, ...account }) => [id, account])),
      integrationNames: new Map(integrationRows.map(({ id, name }) => [id, name])),
      userEmails: new Map(userRows.map(({ id, email }) => [id, email])),
    };
  }
}
