import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, inArray } from "drizzle-orm";
import { chatEndpointOf, providerQuirksSchema } from "@/catalog/schemas/catalog.schema.js";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers } from "@/db/schemas/index.js";
import { type QuotaReaderProvider, QuotaReadError } from "@/quota-meters/models/quota-reader.js";
import type { UsageResetPort } from "@/quota-meters/models/usage-reset.js";
import { QuotaReaders } from "./quota-readers.js";

/** How to list and spend the Usage Resets of one Provider Account. */
export interface UsageResetTarget {
  port: UsageResetPort;
  provider: QuotaReaderProvider;
}

/** Which Provider Accounts have Usage Resets: those whose Provider's quota reader supports them. */
@Injectable()
export class UsageResetTargets {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly readers: QuotaReaders,
  ) {}

  /**
   * Null when the account's Provider has no Usage Resets. Throws
   * NotFoundException for an unknown account, and QuotaReadError when the
   * Provider has no chat endpoint to build the reset endpoints' URL from.
   */
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
    const port = account.quotaReader && this.readers.readerFor(account.quotaReader).usageResets;
    if (!port) {
      return null;
    }
    const chatEndpoint = chatEndpointOf(account.endpoints);
    if (chatEndpoint === undefined) {
      throw new QuotaReadError("The Provider has no chat endpoint to reach its usage resets from");
    }
    const { quotaBaseUrl } = providerQuirksSchema.parse(account.quirks);
    return { port, provider: { baseUrl: chatEndpoint.baseUrl, quotaBaseUrl } };
  }

  /** The ids, among `providerAccountIds`, of the accounts whose Provider has Usage Resets. */
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
      ({ quotaReader }) =>
        quotaReader !== null && this.readers.readerFor(quotaReader).usageResets !== undefined,
    );
    return supporting.map((account) => account.id);
  }
}
