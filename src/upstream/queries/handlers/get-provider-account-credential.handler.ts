import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import type { ProviderAccountCredential } from "@/upstream/models/provider-account-credential";
import { ProviderAccountCredentials } from "@/upstream/providers/provider-account-credentials";
import { GetProviderAccountCredentialQuery } from "@/upstream/queries/impl/get-provider-account-credential.query";

@QueryHandler(GetProviderAccountCredentialQuery)
export class GetProviderAccountCredentialHandler implements IQueryHandler<GetProviderAccountCredentialQuery> {
  constructor(private readonly credentials: ProviderAccountCredentials) {}

  execute({
    providerAccountId,
  }: GetProviderAccountCredentialQuery): Promise<ProviderAccountCredential> {
    return this.credentials.credentialOf(providerAccountId);
  }
}
