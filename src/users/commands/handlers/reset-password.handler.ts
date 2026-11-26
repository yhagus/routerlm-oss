import { PasswordHasher, SessionService } from '@nestjs/authentication';
import { NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { users } from '@/db/schemas';
import { ResetPasswordCommand } from '@/users/commands/impl/reset-password.command';

@CommandHandler(ResetPasswordCommand)
export class ResetPasswordHandler implements ICommandHandler<ResetPasswordCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: SessionService,
  ) {}

  async execute({ userId, password, keepSessionId }: ResetPasswordCommand): Promise<void> {
    const passwordHash = await this.passwordHasher.hash(password);
    const updated = await this.db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated.length === 0) {
      throw new NotFoundException('User not found');
    }
    await this.sessions.revokeAll(userId, { except: keepSessionId });
  }
}
