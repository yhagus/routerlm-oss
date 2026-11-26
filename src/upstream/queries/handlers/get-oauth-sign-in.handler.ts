import { NotFoundException } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { providerAccounts } from "@/db/schemas";
import type { OauthSignIn } from "@/upstream/models/oauth-sign-in";
import { type ProviderAccount, providerAccountColumns } from "@/upstream/models/provider-account";
import { OauthSignInStore } from "@/upstream/providers/oauth-sign-in-store";
import { GetOauthSignInQuery } from "@/upstream/queries/impl/get-oauth-sign-in.query";

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
      throw new NotFoundException("Provider Account not found");
    }
    return account;
  }
}
