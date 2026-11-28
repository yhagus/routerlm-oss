import { Query } from '@nestjs/cqrs';
import type { ConcurrencyWaitSetting } from '@/settings/models/concurrency-wait';

export class ShowConcurrencyWaitQuery extends Query<ConcurrencyWaitSetting> {}
