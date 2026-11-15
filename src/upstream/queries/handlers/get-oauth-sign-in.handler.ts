import { NotFoundException } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import type { OauthSignIn } from "../../models/oauth-sign-in.js";
import { type ProviderAccount, providerAccountColumns } from "../../models/provider-account.js";
import { OauthSignInStore } from "../../providers/oauth-sign-in-store.js";
import { GetOauthSignInQuery } from "../impl/get-oauth-sign-in.query.js";

@QueryHandler(GetOauthSignInQuery)
export class GetOauthSignInHandler implements IQueryHandler<GetOauthSignInQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly signIns: OauthSignInStore,
  ) {}

  async execute({ signInId }: GetOauthSignInQuery): Promise<OauthSignIn> {
    const signIn = await this.signIns.find(signInId);
    if (!signIn) {
      throw new NotFoundException("Sign-in not found");
    }
    const { outcome } = signIn;
    switch (outcome.status) {
      case "pending":
        // The poll that would record the expiry may not have run yet.
        if (Date.now() >= signIn.expiresAt) {
          return { id: signInId, status: "expired" };
        }
        return {
          id: signInId,
          status: "pending",
          userCode: signIn.userCode,
          verificationUri: signIn.verificationUri,
          verificationUriComplete: signIn.verificationUriComplete,
          expiresAt: new Date(signIn.expiresAt),
        };
      case "completed":
        return {
          id: signInId,
          status: "completed",
          providerAccount: await this.providerAccount(outcome.providerAccountId),
        };
      case "denied":
      case "expired":
        return { id: signInId, status: outcome.status };
    }
  }

  private async providerAccount(providerAccountId: string): Promise<ProviderAccount> {
    const [account] = await this.db
      .select(providerAccountColumns)
      .from(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId));
    if (!account) {
      // Deleted since the sign-in completed.
      throw new NotFoundException("Provider Account not found");
    }
    return account;
  }
}
