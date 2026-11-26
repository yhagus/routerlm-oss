import { Command } from "@nestjs/cqrs";
import type { OauthSignIn } from "@/upstream/models/oauth-sign-in";
import type { NewOauthSignIn } from "@/upstream/schemas/oauth-sign-in.schema";

export class StartOauthSignInCommand extends Command<OauthSignIn> {
  constructor(readonly newSignIn: NewOauthSignIn) {
    super();
  }
}
