import { Query } from '@nestjs/cqrs';
import type { ApiKeyPrincipal } from '@/api-keys/models/api-key';
import type { ClientModelList } from '@/inference/models/client-model';

export class ListClientModelsQuery extends Query<ClientModelList> {
  constructor(readonly principal: ApiKeyPrincipal) {
    super();
  }
}
