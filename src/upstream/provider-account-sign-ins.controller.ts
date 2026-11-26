import { Body, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator";
import { StartOauthSignInCommand } from "./commands/impl/start-oauth-sign-in.command";
import type { OauthSignIn } from "./models/oauth-sign-in";
import { GetOauthSignInQuery } from "./queries/impl/get-oauth-sign-in.query";
import { type NewOauthSignIn, newOauthSignInSchema } from "./schemas/oauth-sign-in.schema";

@DashboardController("provider-accounts/sign-ins")
export class ProviderAccountSignInsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  startSignIn(
    @Body({ schema: newOauthSignInSchema }) newSignIn: NewOauthSignIn,
  ): Promise<OauthSignIn> {
    return this.commandBus.execute(new StartOauthSignInCommand(newSignIn));
  }

  @Get(":id")
  getSignIn(@Param("id", ParseUUIDPipe) signInId: string): Promise<OauthSignIn> {
    return this.queryBus.execute(new GetOauthSignInQuery(signInId));
  }
}
