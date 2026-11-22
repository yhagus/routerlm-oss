import { Command } from "@nestjs/cqrs";
import type { CreatedApiKey } from "@/api-keys/models/api-key.js";

/**
 * Replaces a key with a new one on the same row, so its Usage Logs stay
 * linked, and refuses the old key from then on. A revoked key can't be rotated.
 * Records the rotation, by `rotatedById`, in the key's rotation history.
 */
export class RotateApiKeyCommand extends Command<CreatedApiKey> {
  constructor(
    readonly id: string,
    readonly rotatedById: string,
  ) {
    super();
  }
}
