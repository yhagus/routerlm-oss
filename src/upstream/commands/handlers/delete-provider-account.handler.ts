import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { DeleteProviderAccountCommand } from "../impl/delete-provider-account.command.js";

@CommandHandler(DeleteProviderAccountCommand)
export class DeleteProviderAccountHandler implements ICommandHandler<DeleteProviderAccountCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ providerAccountId }: DeleteProviderAccountCommand): Promise<void> {
    const deleted = await this.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId))
      .returning({ id: providerAccounts.id });
    if (deleted.length === 0) {
      throw new NotFoundException("Provider Account not found");
    }
    await this.snapshot.changed();
  }
}
