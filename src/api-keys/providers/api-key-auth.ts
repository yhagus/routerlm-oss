import { ApiKeyProvider, type ApiKeyRecord, AuthenticationRegistry } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { ApiKeyPrincipal } from '@/api-keys/models/api-key';

export const API_KEY_PREFIX = 'rlm';

const API_KEY_AUTH_ORDER = 1;

@Injectable()
export class ApiKeyAuth extends ApiKeyProvider<ApiKeyPrincipal> {
  constructor(
    private readonly snapshot: SnapshotService,
    registry: AuthenticationRegistry,
  ) {
    super({ prefix: API_KEY_PREFIX });
    registry.registerProvider(this, { order: API_KEY_AUTH_ORDER });
  }

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
