import { Query } from "@nestjs/cqrs";
import type { OauthSignIn } from "../../models/oauth-sign-in.js";

/** The state of a sign-in. Throws NotFoundException for one that never started or has been forgotten. */
export class GetOauthSignInQuery extends Query<OauthSignIn> {
  constructor(readonly signInId: string) {
    super();
  }
}
