import { CurrentUser, Public, SignInService } from "@nestjs/authentication";
import { Body, Get, HttpCode, HttpStatus, Post, UnauthorizedException } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { CreateFirstUserCommand } from "@/users/commands/impl/create-first-user.command.js";
import type { User } from "@/users/models/user.js";
import { FindUserByCredentialsQuery } from "@/users/queries/impl/find-user-by-credentials.query.js";
import { IsSetupRequiredQuery } from "@/users/queries/impl/is-setup-required.query.js";
import { type NewUser, newUserSchema } from "@/users/schemas/new-user.schema.js";
import { DashboardController } from "./decorators/dashboard-controller.decorator.js";

const loginSchema = z.object({ email: z.string(), password: z.string() });
type Login = z.infer<typeof loginSchema>;

// One message for an unknown email and a wrong password, so neither is revealed.
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

  /** Creates the first User and signs them in. Refused (409) once any User exists. */
  @Public()
  @Post("setup")
  async completeSetup(@Body({ schema: newUserSchema }) newUser: NewUser): Promise<User> {
    const user = await this.commandBus.execute(new CreateFirstUserCommand(newUser));
    await this.signIn.signIn(user.id, { method: "password" });
    return user;
  }

  @Public()
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
