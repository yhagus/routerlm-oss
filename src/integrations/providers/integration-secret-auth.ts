import { ApiKeyProvider, type ApiKeyRecord, AuthenticationRegistry } from "@nestjs/authentication";
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

// Tried after SessionAuth (0) and ApiKeyAuth (1).
const INTEGRATION_SECRET_AUTH_ORDER = 2;

/**
 * Signs Integrations in with `Authorization: Bearer rlmi_…`, and generates
 * their secrets. Registered in the chain only so `@Authenticate` can name it:
 * every route names its providers, and only the control plane names this one.
 */
@Injectable()
export class IntegrationSecretAuth extends ApiKeyProvider<IntegrationPrincipal> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    registry: AuthenticationRegistry,
  ) {
    super({ prefix: INTEGRATION_SECRET_PREFIX });
    registry.registerProvider(this, { order: INTEGRATION_SECRET_AUTH_ORDER });
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
