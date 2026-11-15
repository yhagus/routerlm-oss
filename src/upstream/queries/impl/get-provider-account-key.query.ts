import { Query } from "@nestjs/cqrs";

/** A Provider Account's key, decrypted. Throws NotFoundException for an unknown account. */
export class GetProviderAccountKeyQuery extends Query<string> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
