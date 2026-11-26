import { Query } from '@nestjs/cqrs';
import type { ModelChoice } from '@/api-keys/models/api-key';

export class ListModelChoicesQuery extends Query<ModelChoice[]> {}
