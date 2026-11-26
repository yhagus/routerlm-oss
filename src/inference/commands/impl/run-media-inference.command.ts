import { Command } from '@nestjs/cqrs';
import type { ClientConnection } from '@/libs/models/client-connection';
import type {
  InferenceCaller,
  RunInferenceTarget,
  UsageListener,
} from '@/inference/models/inference';
import type { MediaClientContract, MediaReply, MediaRequest } from '@/inference/models/media-kind';

export class RunMediaInferenceCommand<
  Request extends MediaRequest = MediaRequest,
  Result = unknown,
> extends Command<MediaReply> {
  constructor(
    readonly contract: MediaClientContract<Request, Result>,
    readonly body: unknown,
    readonly caller: InferenceCaller,
    readonly connection: ClientConnection,
    readonly onUsage: UsageListener = () => {},
    readonly target: RunInferenceTarget = { kind: 'named-model' },
  ) {
    super();
  }
}
