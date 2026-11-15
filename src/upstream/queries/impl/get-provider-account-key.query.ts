import { Query } from "@nestjs/cqrs";

/**
 * A Provider Account's key, decrypted. Throws NotFoundException for an
 * unknown account and ConflictException for one that holds an OAuth Login.
 */
export class GetProviderAccountKeyQuery extends Query<string> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
