import { Command } from "@nestjs/cqrs";
import type { OauthSignIn } from "../../models/oauth-sign-in.js";
import type { NewOauthSignIn } from "../../schemas/oauth-sign-in.schema.js";

/**
 * Starts a sign-in to a Provider that offers OAuth Login: asks its auth host
 * for a user code and has the worker poll until the User approves it, which
 * creates a Provider Account or, when the sign-in names one, replaces that
 * account's OAuth Login and re-enables it. Throws NotFoundException for an
 * unknown Provider or a Provider Account that is not one of its own,
 * ConflictException for a Provider that offers no OAuth Login or a Provider
 * Account that holds an API key, and BadGatewayException when the auth host
 * starts no sign-in.
 */
export class StartOauthSignInCommand extends Command<OauthSignIn> {
  constructor(readonly newSignIn: NewOauthSignIn) {
    super();
  }
}
