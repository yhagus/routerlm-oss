import { z } from "zod";
import type { MediaExchange, MediaOutcome, MediaUpstreamTarget } from "../../models/media-kind.js";
import type {
  SubmittedVideoJob,
  VideoGenerationRequest,
  VideoTaskState,
  VideoUpstreamProtocol,
} from "../../models/video-generation.js";
import { dashScopeFailureReasonOf } from "../dashscope/dashscope-errors.js";
import { UpstreamProtocolError } from "../upstream-protocol-converter.js";

// DashScope's native video API (spec "Phase 4: video"): an asynchronous
// create that answers with a task id, then `GET /tasks/{id}` until the task
// has a video URL, which the gateway relays (ADR 0028).

const SYNTHESIS_PATH = "/services/aigc/video-generation/video-synthesis";
const TASKS_PATH = "/tasks";
/** Without it DashScope refuses the create call: video synthesis is asynchronous only. */
const ASYNC_HEADERS = { "X-DashScope-Async": "enable" };
/** DashScope writes task times without a zone, in China Standard Time. */
const TASK_TIME_ZONE = "+08:00";

const createResponseSchema = z.object({
  output: z.object({ task_id: z.string().min(1) }),
});

const taskResponseSchema = z.object({
  output: z.object({
    task_status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"]),
    end_time: z.string().optional(),
    video_url: z.string().optional(),
  }),
});

/** The request body DashScope takes. */
function requestBodyOf(request: VideoGenerationRequest, target: MediaUpstreamTarget): unknown {
  return {
    model: target.upstreamModelId,
    input: {
      prompt: request.prompt,
      ...(request.media.length > 0 && {
        media: request.media.map(({ role, url }) => ({ type: role, url })),
      }),
    },
    parameters: {
      resolution: request.resolution,
      ...(request.ratio !== null && { ratio: request.ratio }),
      duration: request.seconds,
      watermark: target.isWatermarked,
      ...(request.seed !== null && { seed: request.seed }),
    },
  };
}

async function generate(
  request: VideoGenerationRequest,
  target: MediaUpstreamTarget,
  exchange: MediaExchange,
): Promise<MediaOutcome<SubmittedVideoJob>> {
  const answer = createResponseSchema.safeParse(
    await exchange.postJson(
      `${target.baseUrl}${SYNTHESIS_PATH}`,
      requestBodyOf(request, target),
      ASYNC_HEADERS,
    ),
  );
  if (!answer.success) {
    throw new UpstreamProtocolError(
      `The upstream answered in a shape dashscope-video doesn't allow: ${z.prettifyError(answer.error)}`,
    );
  }
  return {
    result: { request, taskId: answer.data.output.task_id },
    // Counted as requested: the gateway never learns when the job ends (ADR 0027).
    units: { outputSeconds: request.seconds, tier: request.resolution },
  };
}

async function readTask(
  taskId: string,
  target: MediaUpstreamTarget,
  exchange: MediaExchange,
): Promise<VideoTaskState> {
  const answer = taskResponseSchema.safeParse(
    await exchange.getJson(`${target.baseUrl}${TASKS_PATH}/${encodeURIComponent(taskId)}`),
  );
  if (!answer.success) {
    throw new UpstreamProtocolError(
      `The upstream answered in a shape dashscope-video doesn't allow: ${z.prettifyError(answer.error)}`,
    );
  }
  const { task_status, end_time, video_url } = answer.data.output;
  switch (task_status) {
    case "PENDING":
      return { status: "queued" };
    case "RUNNING":
      return { status: "in_progress" };
    case "SUCCEEDED":
      if (video_url === undefined) {
        throw new UpstreamProtocolError("The upstream finished the task without a video URL");
      }
      return { status: "completed", videoUrl: video_url, completedAt: taskTimeOf(end_time) };
    case "FAILED":
    case "CANCELED":
      return { status: "failed", completedAt: taskTimeOf(end_time) };
    case "UNKNOWN":
      // DashScope keeps a task for 24 hours, then no longer knows it.
      return { status: "expired" };
  }
}

/** A DashScope task time, such as `2026-11-19 14:23:39.407`; null when absent or unreadable. */
function taskTimeOf(time: string | undefined): Date | null {
  if (time === undefined) {
    return null;
  }
  const parsed = new Date(`${time.replace(" ", "T")}${TASK_TIME_ZONE}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const dashScopeVideoProtocol: VideoUpstreamProtocol = {
  protocol: "dashscope-video",
  failureReasonOf: dashScopeFailureReasonOf,
  generate,
  readTask,
};
