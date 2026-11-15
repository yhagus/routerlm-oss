import { Query } from "@nestjs/cqrs";
import type { ProviderAccountCredential } from "../../models/provider-account-credential.js";

/**
 * What a call to the Provider sends for a Provider Account: its API key, or
 * its OAuth Login's access token, refreshed first when it is about to run
 * out. Throws NotFoundException for an unknown account,
 * OauthLoginRefusedError when the Provider no longer renews its OAuth Login,
 * and CredentialUnavailableError when a login that has run out can't be
 * renewed for now.
 */
export class GetProviderAccountCredentialQuery extends Query<ProviderAccountCredential> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
