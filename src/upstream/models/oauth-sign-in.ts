import { ServiceUnavailableException } from "@nestjs/common";
import type { ProviderAccount } from "./provider-account.js";

/** What storing a sign-in and queueing its polls throw while Redis is unreachable: a sign-in can't do without it. */
export function signInNeedsRedis(cause: unknown): ServiceUnavailableException {
  return new ServiceUnavailableException("Sign-in needs Redis, which is unreachable", { cause });
}

/**
 * A sign-in to a Provider as the dashboard API returns it: waiting for the
 * User to approve it on the Provider's verification page, or how it ended.
 * It never carries the device code or a token.
 */
export type OauthSignIn = { id: string } & (
  | {
      status: "pending";
      /** What the User types on the verification page. */
      userCode: string;
      verificationUri: string;
      /** The verification page with the code filled in; null when the Provider gives none. */
      verificationUriComplete: string | null;
      /** After this the Provider no longer accepts the code. */
      expiresAt: Date;
    }
  /** Approved: the Provider Account now holding the OAuth Login. */
  | { status: "completed"; providerAccount: ProviderAccount }
  | { status: "denied" }
  | { status: "expired" }
);
