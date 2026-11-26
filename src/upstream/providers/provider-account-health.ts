import { Injectable, Logger } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { providerAccounts } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";

const LAST_ERROR_MAX_LENGTH = 500;

@Injectable()
export class ProviderAccountHealth {
  private readonly logger = new Logger(ProviderAccountHealth.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

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
