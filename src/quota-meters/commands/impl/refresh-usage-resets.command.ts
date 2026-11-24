import { Command } from "@nestjs/cqrs";

export class RefreshUsageResetsCommand extends Command<void> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
