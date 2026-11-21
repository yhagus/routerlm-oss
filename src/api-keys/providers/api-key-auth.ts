import { ApiKeyProvider, type ApiKeyRecord, AuthenticationRegistry } from "@nestjs/authentication";
import { Injectable } from "@nestjs/common";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { ApiKeyPrincipal } from "../models/api-key.js";

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
    private readonly snapshot: SnapshotService,
    registry: AuthenticationRegistry,
  ) {
    super({ prefix: API_KEY_PREFIX });
    registry.registerProvider(this, { order: API_KEY_AUTH_ORDER });
  }

  // Answered from the in-memory snapshot: the inference path reads no
  // PostgreSQL. A revoked key is not in it, so it reads as unknown. The
  // provider checks the hash and the expiry itself.
  protected findKey(keyId: string): ApiKeyRecord<ApiKeyPrincipal> | null {
    const found = this.snapshot.current.apiKeysByKeyId.get(keyId);
    if (!found) {
      return null;
    }
    return {
      hash: found.hash,
      expiresAt: found.expiresAt,
      user: {
        apiKeyId: found.id,
        apiKeyName: found.name,
        allowedModelIds: found.allowedModelIds,
        customer: found.customer,
        spendLimit: found.spendLimit,
        requestRate: found.requestRate,
      },
    };
  }
}
