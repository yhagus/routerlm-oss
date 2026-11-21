import { ApiKeyProvider, type ApiKeyRecord } from "@nestjs/authentication";
import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { integrations } from "@/db/schemas/index.js";
import type { IntegrationPrincipal } from "../models/integration.js";

/**
 * Starts every Integration Secret (`rlmi_<keyId>_<secret>`): distinct from API
 * Keys' `rlm`, so neither is ever taken for the other and secret scanners can tell them apart.
 */
export const INTEGRATION_SECRET_PREFIX = "rlmi";

/**
 * Signs Integrations in with `Authorization: Bearer rlmi_…`, and generates
 * their secrets. It is not registered in the AuthenticationRegistry chain, so
 * no route accepts a secret unless it names this provider in `@Authenticate`.
 */
@Injectable()
export class IntegrationSecretAuth extends ApiKeyProvider<IntegrationPrincipal> {
  constructor(@InjectDrizzle() private readonly db: Database) {
    super({ prefix: INTEGRATION_SECRET_PREFIX });
  }

  // Read from PostgreSQL rather than the snapshot: the control plane is not the
  // inference hot path. A disabled Integration reads as unknown. The provider
  // checks the hash itself.
  protected async findKey(keyId: string): Promise<ApiKeyRecord<IntegrationPrincipal> | null> {
    const [found] = await this.db
      .select({
        id: integrations.id,
        name: integrations.name,
        hash: integrations.hash,
        allowedModelIds: integrations.allowedModelIds,
      })
      .from(integrations)
      .where(and(eq(integrations.keyId, keyId), isNull(integrations.disabledAt)));
    if (!found) {
      return null;
    }
    return {
      hash: found.hash,
      user: {
        integrationId: found.id,
        integrationName: found.name,
        allowedModelIds: found.allowedModelIds,
      },
    };
  }
}
