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
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import type { User } from "./user.js";
import {
  type NewUser,
  newUserSchema,
  type PasswordReset,
  passwordResetSchema,
} from "./users.schemas.js";
import { UsersService } from "./users.service.js";

@DashboardController("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  listUsers(): Promise<User[]> {
    return this.users.listUsers();
  }

  @Post()
  createUser(
    @Body({ schema: newUserSchema }) newUser: NewUser,
    @CurrentUser() creator: User,
  ): Promise<User> {
    return this.users.createUser(newUser, creator.id);
  }

  /** Sets another User's password and signs them out everywhere else. */
  @Put(":id/password")
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Param("id", ParseUUIDPipe) userId: string,
    @Body({ schema: passwordResetSchema }) reset: PasswordReset,
    @CurrentSession() session: SessionRecord,
  ): Promise<void> {
    return this.users.resetPassword(userId, reset.password, session.id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(@Param("id", ParseUUIDPipe) userId: string): Promise<void> {
    return this.users.deleteUser(userId);
  }
}
