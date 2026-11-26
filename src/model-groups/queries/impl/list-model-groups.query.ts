import { Query } from '@nestjs/cqrs';
import type { ModelGroupSummary } from '@/model-groups/models/model-group';

export class ListModelGroupsQuery extends Query<ModelGroupSummary[]> {}
