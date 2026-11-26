import { Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler, QueryBus } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { usageResets } from "@/db/schemas";
import { GetProviderAccountCredentialQuery } from "@/upstream/queries/impl/get-provider-account-credential.query";
import { RefreshUsageResetsCommand } from "@/quota-meters/commands/impl/refresh-usage-resets.command";
import { isUsageResetCallFailure, type UsageResetReading } from "@/quota-meters/models/usage-reset";
import { UsageResetTargets } from "@/quota-meters/providers/usage-reset-targets";

@CommandHandler(RefreshUsageResetsCommand)
export class RefreshUsageResetsHandler implements ICommandHandler<RefreshUsageResetsCommand> {
  private readonly logger = new Logger(RefreshUsageResetsHandler.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly targets: UsageResetTargets,
    private readonly queryBus: QueryBus,
  ) {}

  async execute({ providerAccountId }: RefreshUsageResetsCommand): Promise<void> {
    try {
      const target = await this.targets.targetOf(providerAccountId);
      if (target === null) {
        return;
      }
      const credential = await this.queryBus.execute(
        new GetProviderAccountCredentialQuery(providerAccountId),
      );
      const resets = await target.port.list(credential, target.provider);
      await this.replace(providerAccountId, resets);
    } catch (error) {
      if (!isUsageResetCallFailure(error)) {
        throw error;
      }
      this.logger.warn(
        `Usage reset list of Provider Account ${providerAccountId} failed: ${error.message}`,
      );
    }
  }

  private async replace(providerAccountId: string, resets: UsageResetReading[]): Promise<void> {
    const observedAt = new Date();
    await this.db.transaction(async (tx) => {
      await tx.delete(usageResets).where(eq(usageResets.providerAccountId, providerAccountId));
      if (resets.length > 0) {
        await tx
          .insert(usageResets)
          .values(resets.map((reset) => ({ ...reset, providerAccountId, observedAt })));
      }
    });
  }
}
