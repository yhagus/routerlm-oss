import { Body, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import { StartOauthSignInCommand } from "./commands/impl/start-oauth-sign-in.command.js";
import type { OauthSignIn } from "./models/oauth-sign-in.js";
import { GetOauthSignInQuery } from "./queries/impl/get-oauth-sign-in.query.js";
import { type NewOauthSignIn, newOauthSignInSchema } from "./schemas/oauth-sign-in.schema.js";

/** Adding a Provider Account by signing in to its Provider, where the Provider offers OAuth Login. */
@DashboardController("provider-accounts/sign-ins")
export class ProviderAccountSignInsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /** Returns the code the User approves on the Provider's verification page. */
  @Post()
  startSignIn(
    @Body({ schema: newOauthSignInSchema }) newSignIn: NewOauthSignIn,
  ): Promise<OauthSignIn> {
    return this.commandBus.execute(new StartOauthSignInCommand(newSignIn));
  }

  /** The dashboard reads this until the sign-in is no longer pending; the gateway does the polling. */
  @Get(":id")
  getSignIn(@Param("id", ParseUUIDPipe) signInId: string): Promise<OauthSignIn> {
    return this.queryBus.execute(new GetOauthSignInQuery(signInId));
  }
}
