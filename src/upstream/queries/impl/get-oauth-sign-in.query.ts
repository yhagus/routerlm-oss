import { Query } from "@nestjs/cqrs";
import type { OauthSignIn } from "@/upstream/models/oauth-sign-in.js";

export class GetOauthSignInQuery extends Query<OauthSignIn> {
  constructor(readonly signInId: string) {
    super();
  }
}
