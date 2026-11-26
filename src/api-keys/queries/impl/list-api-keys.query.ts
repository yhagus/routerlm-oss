import { Query } from '@nestjs/cqrs';
import type { ApiKeySummary } from '@/api-keys/models/api-key';
import type { ApiKeyListQuery } from '@/api-keys/schemas/api-key.schema';

export class ListApiKeysQuery extends Query<ApiKeySummary[]> {
  constructor(readonly filter: ApiKeyListQuery = {}) {
    super();
  }
}
