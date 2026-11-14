import { ApiKeyProvider, type ApiKeyRecord, AuthenticationRegistry } from "@nestjs/authentication";
import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/relations.js";
import { apiKeys } from "../db/schema.js";
import type { ApiKeyPrincipal } from "./api-key.js";

/** Starts every key (`rlm_<keyId>_<secret>`), so secret scanners can spot leaked ones. */
export const API_KEY_PREFIX = "rlm";

// Tried after the dashboard's SessionAuth (order 0).
const API_KEY_AUTH_ORDER = 1;

/**
 * Signs clients in with `Authorization: Bearer rlm_…`. Generates keys too.
 * Dashboard routes never accept it (`@DashboardController` allows only
 * SessionAuth); inference routes opt in with `@Authenticate({ providers: [ApiKeyAuth] })`.
 */
@Injectable()
export class ApiKeyAuth extends ApiKeyProvider<ApiKeyPrincipal> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    registry: AuthenticationRegistry,
  ) {
    super({ prefix: API_KEY_PREFIX });
    registry.registerProvider(this, { order: API_KEY_AUTH_ORDER });
  }

  // A revoked key reads as unknown. The provider checks the hash and the expiry itself.
  protected async findKey(keyId: string): Promise<ApiKeyRecord<ApiKeyPrincipal> | null> {
    const [found] = await this.db
      .select({
        id: apiKeys.id,
        hash: apiKeys.hash,
        expiresAt: apiKeys.expiresAt,
        allowedModelIds: apiKeys.allowedModelIds,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyId, keyId), isNull(apiKeys.revokedAt)));
    if (!found) {
      return null;
    }
    return {
      hash: found.hash,
      expiresAt: found.expiresAt,
      user: { apiKeyId: found.id, allowedModelIds: found.allowedModelIds },
    };
  }
}
