import { Metadata } from "@grpc/grpc-js";
import {
  ApiKeyProvider,
  type ApiKeyRecord,
  type ApiKeySession,
  AuthenticationRegistry,
  type AuthenticationResult,
} from "@nestjs/authentication";
import { type ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
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

// A busy Integration polls many times a minute; last_used_at needs no finer grain.
const LAST_USED_RESOLUTION = sql`interval '1 minute'`;

/**
 * Signs Integrations in with `Authorization: Bearer rlmi_…` (over gRPC, the
 * `authorization` metadata with the same value), and generates
 * their secrets. Registered in the chain only so `@Authenticate` can name it:
 * every route names its providers, and only the control plane names this one.
 */
@Injectable()
export class IntegrationSecretAuth extends ApiKeyProvider<IntegrationPrincipal> {
  private readonly logger = new Logger(IntegrationSecretAuth.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    registry: AuthenticationRegistry,
  ) {
    super({ prefix: INTEGRATION_SECRET_PREFIX });
    registry.registerProvider(this, { order: INTEGRATION_SECRET_AUTH_ORDER });
  }

  // The base class reads HTTP headers only: gRPC metadata is transport specific.
  protected override header(context: ExecutionContext, name: string): string | undefined {
    if (context.getType() !== "rpc") {
      return super.header(context, name);
    }
    const metadata: unknown = context.switchToRpc().getContext();
    if (!(metadata instanceof Metadata)) {
      return undefined;
    }
    const [value] = metadata.get(name);
    return typeof value === "string" ? value : undefined;
  }

  override async authenticate(
    context: ExecutionContext,
  ): Promise<AuthenticationResult<IntegrationPrincipal, ApiKeySession> | null> {
    // Throws for a wrong, unknown or disabled secret, so only a sign-in counts as a use.
    const result = await super.authenticate(context);
    if (result) {
      await this.recordUse(result.user.integrationId);
    }
    return result;
  }

  // One conditional UPDATE, so most calls of a busy Integration write nothing.
  // Failing to record a use never fails the call it was recorded for.
  private async recordUse(integrationId: string): Promise<void> {
    try {
      await this.db
        .update(integrations)
        .set({ lastUsedAt: sql`now()` })
        .where(
          and(
            eq(integrations.id, integrationId),
            or(
              isNull(integrations.lastUsedAt),
              lt(integrations.lastUsedAt, sql`now() - ${LAST_USED_RESOLUTION}`),
            ),
          ),
        );
    } catch (error) {
      this.logger.warn(
        `Did not record when Integration ${integrationId} was last used: ${String(error)}`,
      );
    }
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
