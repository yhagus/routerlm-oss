import { Command } from '@nestjs/cqrs';
import type { ConcurrencyWaitSetting } from '@/settings/models/concurrency-wait';

export class ResetConcurrencyWaitCommand extends Command<ConcurrencyWaitSetting> {}
