import { ServiceUnavailableException } from "@nestjs/common";
import type { ProviderAccount } from "./provider-account.js";

export function signInNeedsRedis(cause: unknown): ServiceUnavailableException {
  return new ServiceUnavailableException("Sign-in needs Redis, which is unreachable", { cause });
}

export type OauthSignIn = { id: string } & (
  | {
      status: "pending";
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string | null;
      expiresAt: Date;
    }
  | { status: "completed"; providerAccount: ProviderAccount }
  | { status: "denied" }
  | { status: "expired" }
);
