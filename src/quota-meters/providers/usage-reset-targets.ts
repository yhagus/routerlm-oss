import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers } from "@/db/schemas/index.js";
import {
  type QuotaReaderProvider,
  quotaReaderProviderOf,
} from "@/quota-meters/models/quota-reader.js";
import type { UsageResetPort } from "@/quota-meters/models/usage-reset.js";
import { QuotaReaders } from "./quota-readers.js";

export interface UsageResetTarget {
  port: UsageResetPort;
  provider: QuotaReaderProvider;
}

@Injectable()
export class UsageResetTargets {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly readers: QuotaReaders,
  ) {}

  async targetOf(providerAccountId: string): Promise<UsageResetTarget | null> {
    const [account] = await this.db
      .select({
        quotaReader: providers.quotaReader,
        endpoints: providers.endpoints,
        quirks: providers.quirks,
      })
      .from(providerAccounts)
      .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
      .where(eq(providerAccounts.id, providerAccountId));
    if (!account) {
      throw new NotFoundException("Provider Account not found");
    }
    const port = this.readers.usageResetsOf(account.quotaReader);
    if (port === undefined) {
      return null;
    }
    return { port, provider: quotaReaderProviderOf(account) };
  }

  async withUsageResets(providerAccountIds: string[]): Promise<string[]> {
    if (providerAccountIds.length === 0) {
      return [];
    }
    const accounts = await this.db
      .select({ id: providerAccounts.id, quotaReader: providers.quotaReader })
      .from(providerAccounts)
      .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
      .where(inArray(providerAccounts.id, providerAccountIds));
    const supporting = accounts.filter(
      ({ quotaReader }) => this.readers.usageResetsOf(quotaReader) !== undefined,
    );
    return supporting.map((account) => account.id);
  }
}
