import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { CooldownStore } from "@/upstream/providers/cooldown-store";
import { EndProviderAccountExhaustedCommand } from "@/upstream/commands/impl/end-provider-account-exhausted.command";

@CommandHandler(EndProviderAccountExhaustedCommand)
export class EndProviderAccountExhaustedHandler implements ICommandHandler<EndProviderAccountExhaustedCommand> {
  constructor(private readonly cooldowns: CooldownStore) {}

  async execute({ providerAccountId }: EndProviderAccountExhaustedCommand): Promise<void> {
    await this.cooldowns.endExhausted(providerAccountId);
  }
}
