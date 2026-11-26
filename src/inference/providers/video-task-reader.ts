import { Injectable } from '@nestjs/common';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { AttemptFailedError, gatewayErrorFor } from '@/inference/models/attempt-failure';
import { GatewayError } from '@/inference/models/gateway-error';
import type { InferenceCaller } from '@/inference/models/inference';
import { endpointOf } from '@/inference/models/route-selection';
import type { VideoTaskState } from '@/inference/models/video-generation';
import { upstreamAuthHeaders } from '@/inference/protocols/converters';
import { VIDEO_UPSTREAM_PROTOCOLS } from '@/inference/protocols/openai-videos/openai-videos-client-contract';
import { AttemptRunner } from './attempt-runner';
import { MediaUpstreamClient } from './media-upstream-client';
import { DEFAULT_TIMEOUTS } from './upstream-client';
import { VideoHandles, type VideoJobHandle } from './video-handles';

export interface ReadVideoJob {
  handle: VideoJobHandle;
  state: VideoTaskState;
}

@Injectable()
export class VideoTaskReader {
  constructor(
    private readonly handles: VideoHandles,
    private readonly snapshot: SnapshotService,
    private readonly attempts: AttemptRunner,
    private readonly upstream: MediaUpstreamClient,
  ) {}

  async read(
    videoId: string,
    caller: InferenceCaller,
    clientSignal: AbortSignal,
  ): Promise<ReadVideoJob> {
    const handle = this.handles.open(videoId, caller);
    if (!handle) {
      throw videoNotFound();
    }
    const upstreamModel = this.snapshot.current.upstreamModelsById.get(handle.upstreamModelRowId);
    const account = upstreamModel?.provider.providerAccounts.find(
      ({ id }) => id === handle.providerAccountId,
    );
    const endpoint = upstreamModel && endpointOf(upstreamModel);
    const protocol = endpoint && VIDEO_UPSTREAM_PROTOCOLS[endpoint.protocol];
    if (!upstreamModel || !account?.isEnabled || !endpoint || !protocol) {
      throw videoNotFound();
    }
    try {
      const credential = await this.attempts.credentialOf(account);
      const state = await this.upstream.exchange(
        {
          authHeaders: {
            ...credential.identityHeaders,
            ...upstreamAuthHeaders(upstreamModel.provider.authStyle, credential.secret),
          },
          timeouts: DEFAULT_TIMEOUTS,
          clientSignal,
          failureReasonOf: (status, body) => protocol.failureReasonOf(status, body),
        },
        (exchange) =>
          protocol.readTask(
            handle.taskId,
            {
              baseUrl: endpoint.baseUrl,
              upstreamModelId: upstreamModel.upstreamModelId,
              isWatermarked: false,
            },
            exchange,
          ),
      );
      return { handle, state };
    } catch (error) {
      throw error instanceof AttemptFailedError ? gatewayErrorFor(error) : error;
    }
  }
}

export function videoNotFound(): GatewayError {
  return new GatewayError('video_not_found', 'No such video', 'client');
}
