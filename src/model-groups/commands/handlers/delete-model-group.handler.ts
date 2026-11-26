import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, ne, notExists } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '@/db/schemas/relations';
import { modelGroupMembers, modelGroups, models } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { DeleteModelGroupCommand } from '@/model-groups/commands/impl/delete-model-group.command';

@CommandHandler(DeleteModelGroupCommand)
export class DeleteModelGroupHandler implements ICommandHandler<DeleteModelGroupCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelGroupId }: DeleteModelGroupCommand): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const strandedModels = await findModelsOnlyIn(transaction, modelGroupId);
      if (strandedModels.length > 0) {
        throw new ConflictException(
          `This Model Group is the only group of these Models: ${strandedModels.join(', ')}. Add them to another group first.`,
        );
      }
      const deleted = await transaction
        .delete(modelGroups)
        .where(eq(modelGroups.id, modelGroupId))
        .returning({ id: modelGroups.id });
      if (deleted.length === 0) {
        throw new NotFoundException('Model Group not found');
      }
    });
    await this.snapshot.changed();
  }
}

async function findModelsOnlyIn(transaction: Transaction, modelGroupId: string): Promise<string[]> {
  const otherMemberships = alias(modelGroupMembers, 'other_memberships');
  const rows = await transaction
    .select({ name: models.name })
    .from(modelGroupMembers)
    .innerJoin(models, eq(modelGroupMembers.modelId, models.id))
    .where(
      and(
        eq(modelGroupMembers.modelGroupId, modelGroupId),
        notExists(
          transaction
            .select()
            .from(otherMemberships)
            .where(
              and(
                eq(otherMemberships.modelId, modelGroupMembers.modelId),
                ne(otherMemberships.modelGroupId, modelGroupId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(models.name));
  return rows.map((row) => row.name);
}
