import { Command } from '@nestjs/cqrs';
import type { ConcurrencyWaitSetting } from '@/settings/models/concurrency-wait';

export class ChangeConcurrencyWaitCommand extends Command<ConcurrencyWaitSetting> {
  constructor(readonly seconds: number) {
    super();
  }
}
