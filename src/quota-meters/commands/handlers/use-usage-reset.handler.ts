import { BadGatewayException, ConflictException, NotFoundException } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler, QueryBus } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { usageResets } from "@/db/schemas/index.js";
import { GetProviderAccountCredentialQuery } from "@/upstream/queries/impl/get-provider-account-credential.query.js";
import { ReadProviderAccountQuotaCommand } from "@/quota-meters/commands/impl/read-provider-account-quota.command.js";
import { RefreshUsageResetsCommand } from "@/quota-meters/commands/impl/refresh-usage-resets.command.js";
import { UseUsageResetCommand } from "@/quota-meters/commands/impl/use-usage-reset.command.js";
import { type ProviderAccountQuota, recordQuotaError } from "@/quota-meters/models/quota-meter.js";
import {
  isUnexpired,
  isUsageResetCallFailure,
  type UsageResetOutcome,
} from "@/quota-meters/models/usage-reset.js";
import { UsageResetTargets } from "@/quota-meters/providers/usage-reset-targets.js";

// 409 rather than 400: the request is well formed, but the account's Provider
// can't honour it.
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
      // The dashboard shows the failure on the account, as it does a failed reading's.
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
        // The stored list was stale: the next pick should not offer it again.
        await this.commandBus.execute(new RefreshUsageResetsCommand(providerAccountId));
        throw new ConflictException(UNAVAILABLE_MESSAGE);
      case "reset":
        // A failed list fetch is only logged: the reset is spent either way.
        await this.commandBus.execute(new RefreshUsageResetsCommand(providerAccountId));
        // The reading may end the account's Exhausted state.
        return this.commandBus.execute(new ReadProviderAccountQuotaCommand(providerAccountId));
    }
  }

  /**
   * Asks the Provider to spend the reset. Throws an error that passes
   * isUsageResetCallFailure when the Provider or the credential fails.
   */
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

  /** The Provider's id of an unexpired reset of the account; a reset no longer listed is not found. */
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
