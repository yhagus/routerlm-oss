import { Query } from "@nestjs/cqrs";
import type { ProviderAccountCredential } from "@/upstream/models/provider-account-credential";

export class GetProviderAccountCredentialQuery extends Query<ProviderAccountCredential> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
