import { Command } from '@nestjs/cqrs';

export class ReloadSnapshotCommand extends Command<void> {}
