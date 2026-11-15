import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import type { ProviderAccountCredential } from "../../models/provider-account-credential.js";
import { ProviderAccountCredentials } from "../../providers/provider-account-credentials.js";
import { GetProviderAccountCredentialQuery } from "../impl/get-provider-account-credential.query.js";

@QueryHandler(GetProviderAccountCredentialQuery)
export class GetProviderAccountCredentialHandler implements IQueryHandler<GetProviderAccountCredentialQuery> {
  constructor(private readonly credentials: ProviderAccountCredentials) {}

  execute({
    providerAccountId,
  }: GetProviderAccountCredentialQuery): Promise<ProviderAccountCredential> {
    return this.credentials.credentialOf(providerAccountId);
  }
}
