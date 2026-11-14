import { Injectable, Logger } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "../db/relations.js";
import { providerAccounts } from "../db/schema.js";
import { SnapshotService } from "../snapshot/snapshot.service.js";

// Enough to tell failures apart on the dashboard; the rest is in the logs.
const LAST_ERROR_MAX_LENGTH = 500;

/**
 * What the gateway writes about a Provider Account after a failed Attempt.
 * Called without awaiting from the inference path, so these never throw:
 * the request goes on (or has already ended) whatever happens here.
 */
@Injectable()
export class ProviderAccountHealth {
  private readonly logger = new Logger(ProviderAccountHealth.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  /** Keeps the failure as the Provider Account's last error, for the dashboard. */
  async recordFailure(providerAccountId: string, lastError: string): Promise<void> {
    try {
      await this.db
        .update(providerAccounts)
        .set({ lastError: lastError.slice(0, LAST_ERROR_MAX_LENGTH), lastErrorAt: new Date() })
        .where(eq(providerAccounts.id, providerAccountId));
    } catch (error) {
      this.logger.error(
        `Last error not recorded for Provider Account ${providerAccountId}: ${String(error)}`,
      );
    }
  }

  /**
   * Disables the Provider Account until an operator re-enables it on the
   * dashboard, and refreshes every instance's snapshot so no request uses it.
   */
  async disable(providerAccountId: string, reason: string, lastError: string): Promise<void> {
    try {
      await this.db
        .update(providerAccounts)
        .set({
          isEnabled: false,
          disabledReason: reason,
          lastError: lastError.slice(0, LAST_ERROR_MAX_LENGTH),
          lastErrorAt: new Date(),
        })
        .where(eq(providerAccounts.id, providerAccountId));
    } catch (error) {
      this.logger.error(`Provider Account ${providerAccountId} not disabled: ${String(error)}`);
      return;
    }
    await this.snapshot.changed();
  }
}
