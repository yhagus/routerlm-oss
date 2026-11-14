import { CurrentUser, Public, SignInService } from "@nestjs/authentication";
import { Body, Get, HttpCode, HttpStatus, Post, UnauthorizedException } from "@nestjs/common";
import { z } from "zod";
import type { User } from "../users/user.js";
import { type NewUser, newUserSchema } from "../users/users.schemas.js";
import { UsersService } from "../users/users.service.js";
import { DashboardController } from "./dashboard-controller.decorator.js";

const loginSchema = z.object({ email: z.string(), password: z.string() });
type Login = z.infer<typeof loginSchema>;

// One message for an unknown email and a wrong password, so neither is revealed.
const INVALID_CREDENTIALS = "Invalid email or password";

@DashboardController("auth")
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly signIn: SignInService,
  ) {}

  @Public()
  @Get("setup")
  async getSetupStatus(): Promise<{ isSetupRequired: boolean }> {
    return { isSetupRequired: await this.users.isSetupRequired() };
  }

  /** Creates the first User and signs them in. Refused (409) once any User exists. */
  @Public()
  @Post("setup")
  async completeSetup(@Body({ schema: newUserSchema }) newUser: NewUser): Promise<User> {
    const user = await this.users.createFirstUser(newUser);
    await this.signIn.signIn(user.id, { method: "password" });
    return user;
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body({ schema: loginSchema }) login: Login): Promise<User> {
    const user = await this.users.findUserByCredentials(login.email, login.password);
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
