import { Command } from '@nestjs/cqrs';
import type { ErrorCaptureRetention } from '@/settings/models/error-capture-retention';

export class ResetErrorCaptureRetentionCommand extends Command<ErrorCaptureRetention> {}
