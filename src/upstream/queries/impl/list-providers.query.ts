import { Query } from '@nestjs/cqrs';
import type { Provider } from '@/upstream/models/provider';

export class ListProvidersQuery extends Query<Provider[]> {}
