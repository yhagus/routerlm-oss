import { Command } from "@nestjs/cqrs";

/** Refuses the key from now on. Revoking a revoked key keeps its first revocation time. */
export class RevokeApiKeyCommand extends Command<void> {
  constructor(readonly id: string) {
    super();
  }
}
