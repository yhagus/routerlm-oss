import { Query } from "@nestjs/cqrs";

export class RevealApiKeyQuery extends Query<{ key: string }> {
  constructor(readonly id: string) {
    super();
  }
}
