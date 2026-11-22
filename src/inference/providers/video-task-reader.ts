import { Injectable } from "@nestjs/common";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { AttemptFailedError, gatewayErrorFor } from "@/inference/models/attempt-failure.js";
import { GatewayError } from "@/inference/models/gateway-error.js";
import type { InferenceCaller } from "@/inference/models/inference.js";
import { endpointOf } from "@/inference/models/route-selection.js";
import type { VideoTaskState } from "@/inference/models/video-generation.js";
import { upstreamAuthHeaders } from "@/inference/protocols/converters.js";
import { VIDEO_UPSTREAM_PROTOCOLS } from "@/inference/protocols/openai-videos/openai-videos-client-contract.js";
import { AttemptRunner } from "./attempt-runner.js";
import { MediaUpstreamClient } from "./media-upstream-client.js";
import { DEFAULT_TIMEOUTS } from "./upstream-client.js";
import { VideoHandles, type VideoJobHandle } from "./video-handles.js";

/** A Video Job as its upstream task stands now. */
export interface ReadVideoJob {
  handle: VideoJobHandle;
  state: VideoTaskState;
}

/**
 * Reads a Video Job's state from its upstream task: one call to the Provider
 * Account its id names, with no Fallback and no Cooldown on failure (ADR
 * 0027). Writes no Usage Log: the job was counted when it was submitted.
 */
@Injectable()
export class VideoTaskReader {
  constructor(
    private readonly handles: VideoHandles,
    private readonly snapshot: SnapshotService,
    private readonly attempts: AttemptRunner,
    private readonly upstream: MediaUpstreamClient,
  ) {}

  /** Throws `video_not_found` for an id `caller` wasn't issued, or whose Provider Account is gone or disabled. */
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
              // Decided at submit; reading the task generates nothing.
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
  return new GatewayError("video_not_found", "No such video", "client");
}
