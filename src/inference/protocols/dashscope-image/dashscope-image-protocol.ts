import { z } from "zod";
import type {
  GeneratedImages,
  ImageGenerationRequest,
  ImageSize,
} from "../../models/image-generation.js";
import { providerSizeOf, sizeTierOf } from "../../models/image-generation.js";
import type {
  MediaExchange,
  MediaOutcome,
  MediaUpstreamProtocol,
  MediaUpstreamTarget,
} from "../../models/media-kind.js";
import { dashScopeFailureReasonOf } from "../dashscope/dashscope-errors.js";
import { UpstreamProtocolError } from "../upstream-protocol-converter.js";

// DashScope's native image API (spec "Phase 1: image"): one synchronous call
// that answers with URLs of the generated images, which the gateway fetches.

const GENERATION_PATH = "/services/aigc/multimodal-generation/generation";

const responseSchema = z.object({
  output: z.object({
    choices: z
      .array(
        z.object({
          message: z.object({ content: z.array(z.object({ image: z.string().optional() })) }),
        }),
      )
      .min(1),
  }),
  usage: z
    .object({
      output_width: z.int().positive().optional(),
      output_height: z.int().positive().optional(),
    })
    .optional(),
});

/** The request body DashScope takes. */
function requestBodyOf(request: ImageGenerationRequest, target: MediaUpstreamTarget): unknown {
  return {
    model: target.upstreamModelId,
    input: { messages: [{ role: "user", content: [{ text: request.prompt }] }] },
    parameters: {
      ...(request.size && { size: providerSizeOf(request.size) }),
      n: request.n,
      watermark: target.isWatermarked,
      ...(request.negativePrompt !== null && { negative_prompt: request.negativePrompt }),
      ...(request.seed !== null && { seed: request.seed }),
    },
  };
}

async function generate(
  request: ImageGenerationRequest,
  target: MediaUpstreamTarget,
  exchange: MediaExchange,
): Promise<MediaOutcome<GeneratedImages>> {
  const answer = responseSchema.safeParse(
    await exchange.postJson(`${target.baseUrl}${GENERATION_PATH}`, requestBodyOf(request, target)),
  );
  if (!answer.success) {
    throw new UpstreamProtocolError(
      `The upstream answered in a shape dashscope-image doesn't allow: ${z.prettifyError(answer.error)}`,
    );
  }
  const urls = answer.data.output.choices.flatMap(({ message }) =>
    message.content.flatMap(({ image }) => (image === undefined ? [] : [image])),
  );
  if (urls.length === 0) {
    throw new UpstreamProtocolError("The upstream answered without an image");
  }
  const images = await Promise.all(urls.map((url) => exchange.fetchMedia(url)));
  const outputSize = outputSizeOf(answer.data.usage) ?? request.size;
  return {
    result: { images },
    units: {
      imagesOut: images.length,
      imagesIn: 0,
      ...(outputSize && { tier: sizeTierOf(outputSize) }),
    },
  };
}

/** The size DashScope says it generated, which is what it bills; null when it doesn't say. */
function outputSizeOf(usage: z.infer<typeof responseSchema>["usage"]): ImageSize | null {
  if (usage?.output_width === undefined || usage.output_height === undefined) {
    return null;
  }
  return { width: usage.output_width, height: usage.output_height };
}

export const dashScopeImageProtocol: MediaUpstreamProtocol<
  ImageGenerationRequest,
  GeneratedImages
> = {
  protocol: "dashscope-image",
  failureReasonOf: dashScopeFailureReasonOf,
  generate,
};
