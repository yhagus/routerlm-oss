import { Metadata } from '@grpc/grpc-js';
import {
  ApiKeyProvider,
  type ApiKeyRecord,
  type ApiKeySession,
  AuthenticationRegistry,
  type AuthenticationResult,
} from '@nestjs/authentication';
import { type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { integrations } from '@/db/schemas';
import type { IntegrationPrincipal } from '@/integrations/models/integration';

export const INTEGRATION_SECRET_PREFIX = 'rlmi';

const INTEGRATION_SECRET_AUTH_ORDER = 2;

const LAST_USED_RESOLUTION = sql`interval '1 minute'`;

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

  protected override header(context: ExecutionContext, name: string): string | undefined {
    if (context.getType() !== 'rpc') {
      return super.header(context, name);
    }
    const metadata: unknown = context.switchToRpc().getContext();
    if (!(metadata instanceof Metadata)) {
      return undefined;
    }
    const [value] = metadata.get(name);
    return typeof value === 'string' ? value : undefined;
  }

  override async authenticate(
    context: ExecutionContext,
  ): Promise<AuthenticationResult<IntegrationPrincipal, ApiKeySession> | null> {
    const result = await super.authenticate(context);
    if (result) {
      await this.recordUse(result.user.integrationId);
    }
    return result;
  }

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
