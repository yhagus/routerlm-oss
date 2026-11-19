import { Query } from "@nestjs/cqrs";

/** The whole key, decrypted, for the dashboard to copy. */
export class RevealApiKeyQuery extends Query<{ key: string }> {
  constructor(readonly id: string) {
    super();
  }
}
