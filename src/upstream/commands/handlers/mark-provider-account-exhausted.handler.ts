import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { CooldownStore } from "@/upstream/providers/cooldown-store";
import { MarkProviderAccountExhaustedCommand } from "@/upstream/commands/impl/mark-provider-account-exhausted.command";

const EXHAUSTED_UNTIL_READ_MS = 60_000;

@CommandHandler(MarkProviderAccountExhaustedCommand)
export class MarkProviderAccountExhaustedHandler implements ICommandHandler<MarkProviderAccountExhaustedCommand> {
  constructor(private readonly cooldowns: CooldownStore) {}

  async execute({ providerAccountId, until }: MarkProviderAccountExhaustedCommand): Promise<void> {
    await this.cooldowns.markExhausted(
      providerAccountId,
      until ?? new Date(Date.now() + EXHAUSTED_UNTIL_READ_MS),
    );
  }
}
