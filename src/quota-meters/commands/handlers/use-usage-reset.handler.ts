import { BadGatewayException, ConflictException, NotFoundException } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler, QueryBus } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { usageResets } from "@/db/schemas";
import { GetProviderAccountCredentialQuery } from "@/upstream/queries/impl/get-provider-account-credential.query";
import { ReadProviderAccountQuotaCommand } from "@/quota-meters/commands/impl/read-provider-account-quota.command";
import { RefreshUsageResetsCommand } from "@/quota-meters/commands/impl/refresh-usage-resets.command";
import { UseUsageResetCommand } from "@/quota-meters/commands/impl/use-usage-reset.command";
import { type ProviderAccountQuota, recordQuotaError } from "@/quota-meters/models/quota-meter";
import {
  isUnexpired,
  isUsageResetCallFailure,
  type UsageResetOutcome,
} from "@/quota-meters/models/usage-reset";
import { UsageResetTargets } from "@/quota-meters/providers/usage-reset-targets";

const UNSUPPORTED_MESSAGE = "The Provider of this Provider Account has no usage resets";
const NOTHING_TO_RESET_MESSAGE = "No meter is low enough to reset yet";
const UNAVAILABLE_MESSAGE = "That reset is no longer available";

@CommandHandler(UseUsageResetCommand)
export class UseUsageResetHandler implements ICommandHandler<UseUsageResetCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly targets: UsageResetTargets,
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  async execute(command: UseUsageResetCommand): Promise<ProviderAccountQuota> {
    const { providerAccountId } = command;
    let outcome: UsageResetOutcome;
    try {
      outcome = await this.spend(command);
    } catch (error) {
      if (!isUsageResetCallFailure(error)) {
        throw error;
      }
      await recordQuotaError(this.db, providerAccountId, {
        error: error.message,
        checkedAt: new Date(),
      });
      throw new BadGatewayException(error.message);
    }

    switch (outcome) {
      case "nothing-to-reset":
        throw new ConflictException(NOTHING_TO_RESET_MESSAGE);
      case "unavailable":
        await this.commandBus.execute(new RefreshUsageResetsCommand(providerAccountId));
        throw new ConflictException(UNAVAILABLE_MESSAGE);
      case "reset":
        await this.commandBus.execute(new RefreshUsageResetsCommand(providerAccountId));
        return this.commandBus.execute(new ReadProviderAccountQuotaCommand(providerAccountId));
    }
  }

  private async spend({
    providerAccountId,
    usageResetId,
    idempotencyKey,
  }: UseUsageResetCommand): Promise<UsageResetOutcome> {
    const target = await this.targets.targetOf(providerAccountId);
    if (target === null) {
      throw new ConflictException(UNSUPPORTED_MESSAGE);
    }
    const externalId = await this.externalIdOf(providerAccountId, usageResetId);
    const credential = await this.queryBus.execute(
      new GetProviderAccountCredentialQuery(providerAccountId),
    );
    return target.port.use(credential, target.provider, { externalId, idempotencyKey });
  }

  private async externalIdOf(providerAccountId: string, usageResetId: string): Promise<string> {
    const [reset] = await this.db
      .select({ externalId: usageResets.externalId })
      .from(usageResets)
      .where(
        and(
          eq(usageResets.id, usageResetId),
          eq(usageResets.providerAccountId, providerAccountId),
          isUnexpired(new Date()),
        ),
      );
    if (!reset) {
      throw new NotFoundException("Usage reset not found");
    }
    return reset.externalId;
  }
}
