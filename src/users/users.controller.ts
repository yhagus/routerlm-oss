import { CurrentSession, CurrentUser, type SessionRecord } from "@nestjs/authentication";
import {
  Body,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator";
import { CreateUserCommand } from "./commands/impl/create-user.command";
import { DeleteUserCommand } from "./commands/impl/delete-user.command";
import { ResetPasswordCommand } from "./commands/impl/reset-password.command";
import type { User } from "./models/user";
import { ListUsersQuery } from "./queries/impl/list-users.query";
import { type NewUser, newUserSchema } from "./schemas/new-user.schema";
import { type PasswordReset, passwordResetSchema } from "./schemas/password-reset.schema";

@DashboardController("users")
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listUsers(): Promise<User[]> {
    return this.queryBus.execute(new ListUsersQuery());
  }

  @Post()
  createUser(
    @Body({ schema: newUserSchema }) newUser: NewUser,
    @CurrentUser() creator: User,
  ): Promise<User> {
    return this.commandBus.execute(new CreateUserCommand(newUser, creator.id));
  }

  @Put(":id/password")
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Param("id", ParseUUIDPipe) userId: string,
    @Body({ schema: passwordResetSchema }) reset: PasswordReset,
    @CurrentSession() session: SessionRecord,
  ): Promise<void> {
    return this.commandBus.execute(new ResetPasswordCommand(userId, reset.password, session.id));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(@Param("id", ParseUUIDPipe) userId: string): Promise<void> {
    return this.commandBus.execute(new DeleteUserCommand(userId));
  }
}
