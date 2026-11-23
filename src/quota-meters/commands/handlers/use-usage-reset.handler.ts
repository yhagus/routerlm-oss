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
import type { ProviderAccountQuota } from "@/quota-meters/models/quota-meter.js";
import {
  isUnexpired,
  isUsageResetCallFailure,
  type UsageResetOutcome,
} from "@/quota-meters/models/usage-reset.js";
import {
  type UsageResetTarget,
  UsageResetTargets,
} from "@/quota-meters/providers/usage-reset-targets.js";

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

  async execute({
    providerAccountId,
    usageResetId,
    idempotencyKey,
  }: UseUsageResetCommand): Promise<ProviderAccountQuota> {
    const target = await this.targetOf(providerAccountId);
    if (target === null) {
      throw new ConflictException(UNSUPPORTED_MESSAGE);
    }
    const externalId = await this.externalIdOf(providerAccountId, usageResetId);
    const outcome = await this.spend(providerAccountId, target, { externalId, idempotencyKey });

    switch (outcome) {
      case "nothing-to-reset":
        throw new ConflictException(NOTHING_TO_RESET_MESSAGE);
      case "unavailable":
        // The stored list was stale: the next pick should not offer it again.
        await this.commandBus.execute(new RefreshUsageResetsCommand(providerAccountId));
        throw new ConflictException(UNAVAILABLE_MESSAGE);
      case "reset":
        await this.commandBus.execute(new RefreshUsageResetsCommand(providerAccountId));
        // The reading may end the account's Exhausted state.
        return this.commandBus.execute(new ReadProviderAccountQuotaCommand(providerAccountId));
    }
  }

  private async targetOf(providerAccountId: string): Promise<UsageResetTarget | null> {
    try {
      return await this.targets.targetOf(providerAccountId);
    } catch (error) {
      throw badGatewayFor(error);
    }
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

  private async spend(
    providerAccountId: string,
    { port, provider }: UsageResetTarget,
    spend: { externalId: string; idempotencyKey: string },
  ): Promise<UsageResetOutcome> {
    try {
      const credential = await this.queryBus.execute(
        new GetProviderAccountCredentialQuery(providerAccountId),
      );
      return await port.use(credential, provider, spend);
    } catch (error) {
      throw badGatewayFor(error);
    }
  }
}

/**
 * A failed call to the Provider answers 502 with the reason a failed quota
 * reading records, such as `The OpenAI quota endpoint answered HTTP 401`;
 * any other error is a bug and is thrown as it is.
 */
function badGatewayFor(error: unknown): BadGatewayException {
  if (isUsageResetCallFailure(error)) {
    return new BadGatewayException(error.message);
  }
  throw error;
}
