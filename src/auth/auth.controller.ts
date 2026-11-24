import { CurrentUser, Public, SignInService } from "@nestjs/authentication";
import {
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import { CreateFirstUserCommand } from "@/users/commands/impl/create-first-user.command.js";
import type { User } from "@/users/models/user.js";
import { FindUserByCredentialsQuery } from "@/users/queries/impl/find-user-by-credentials.query.js";
import { IsSetupRequiredQuery } from "@/users/queries/impl/is-setup-required.query.js";
import { type NewUser, newUserSchema } from "@/users/schemas/new-user.schema.js";
import { DashboardController } from "./decorators/dashboard-controller.decorator.js";

const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 1_024;
const loginSchema = z.object({
  email: z.string().max(MAX_EMAIL_LENGTH),
  password: z.string().max(MAX_PASSWORD_LENGTH),
});
type Login = z.infer<typeof loginSchema>;

const INVALID_CREDENTIALS = "Invalid email or password";

@DashboardController("auth")
export class AuthController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly signIn: SignInService,
  ) {}

  @Public()
  @Get("setup")
  async getSetupStatus(): Promise<{ isSetupRequired: boolean }> {
    return { isSetupRequired: await this.queryBus.execute(new IsSetupRequiredQuery()) };
  }

  @Public()
  @Post("setup")
  async completeSetup(@Body({ schema: newUserSchema }) newUser: NewUser): Promise<User> {
    const user = await this.commandBus.execute(new CreateFirstUserCommand(newUser));
    await this.signIn.signIn(user.id, { method: "password" });
    return user;
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body({ schema: loginSchema }) login: Login): Promise<User> {
    const user = await this.queryBus.execute(
      new FindUserByCredentialsQuery(login.email, login.password),
    );
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    await this.signIn.signIn(user.id, { method: "password" });
    return user;
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(): Promise<void> {
    await this.signIn.signOut();
  }

  @Get("me")
  getCurrentUser(@CurrentUser() user: User): User {
    return user;
  }
}
