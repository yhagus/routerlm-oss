import type { IncomingMessage, ServerResponse } from "node:http";
import { Authenticate, CurrentUser } from "@nestjs/authentication";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { FileFieldsInterceptor, FileInterceptor } from "@nestjs/platform-node";
import type { ApiKeyPrincipal } from "@/api-keys/models/api-key.js";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth.js";
import { clientConnectionOf } from "@/libs/models/client-connection.js";
import { eventStreamResponse } from "@/libs/models/event-stream-response.js";
import type { ClientModelList } from "./models/client-model.js";
import type { InferenceResult } from "./models/inference.js";
import type { MediaReply } from "./models/media-kind.js";
import { RunInferenceCommand } from "./commands/impl/run-inference.command.js";
import { RunMediaInferenceCommand } from "./commands/impl/run-media-inference.command.js";
import { SubmitVideoJobCommand } from "./commands/impl/submit-video-job.command.js";
import { DownloadVideoContentQuery } from "./queries/impl/download-video-content.query.js";
import { ListClientModelsQuery } from "./queries/impl/list-client-models.query.js";
import { RetrieveVideoJobQuery } from "./queries/impl/retrieve-video-job.query.js";
import { anthropicMessagesClientConverter } from "./protocols/anthropic-messages/anthropic-messages-client-converter.js";
import { openAiChatClientConverter } from "./protocols/openai-chat/openai-chat-client-converter.js";
import {
  MEDIA_UPLOAD_OPTIONS,
  type UploadedFile as UploadedMediaFile,
} from "./models/uploaded-file.js";
import {
  IMAGE_EDIT_FILE_FIELDS,
  type ImageEditFiles,
  imageEditBodyOf,
} from "./protocols/openai-images/openai-image-edits-form.js";
import {
  openAiImageEditsClientContract,
  openAiImagesClientContract,
} from "./protocols/openai-images/openai-images-client-contract.js";
import {
  VIDEO_FIRST_FRAME_FIELD,
  videoBodyOf,
} from "./protocols/openai-videos/openai-video-form.js";
import { openAiSpeechClientContract } from "./protocols/openai-speech/openai-speech-client-contract.js";
import { openAiResponsesClientConverter } from "./protocols/openai-responses/openai-responses-client-converter.js";

/** What Nest sends with a JSON body it serialises itself. */
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** Where client applications call the gateway. */
export const INFERENCE_API_PREFIX = "v1";

/**
 * The client-facing inference API. Only API Keys sign in here; because of
 * that restriction, `@CurrentUser()` is always an ApiKeyPrincipal on these routes.
 */
@Controller(INFERENCE_API_PREFIX)
@Authenticate({ providers: [ApiKeyAuth] })
export class InferenceController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post("chat/completions")
  @HttpCode(200)
  async createChatCompletion(
    @Body() body: unknown,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Uint8Array | Response> {
    const result = await this.commandBus.execute(
      new RunInferenceCommand(
        openAiChatClientConverter,
        body,
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return replyWith(result, response);
  }

  @Post("messages")
  @HttpCode(200)
  async createMessage(
    @Body() body: unknown,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Uint8Array | Response> {
    const result = await this.commandBus.execute(
      new RunInferenceCommand(
        anthropicMessagesClientConverter,
        body,
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return replyWith(result, response);
  }

  @Post("responses")
  @HttpCode(200)
  async createResponse(
    @Body() body: unknown,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Uint8Array | Response> {
    const result = await this.commandBus.execute(
      new RunInferenceCommand(
        openAiResponsesClientConverter,
        body,
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return replyWith(result, response);
  }

  @Post("images/generations")
  @HttpCode(200)
  async createImage(
    @Body() body: unknown,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Uint8Array> {
    const reply = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        openAiImagesClientContract,
        body,
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return replyWithMedia(reply, response);
  }

  @Post("audio/speech")
  @HttpCode(200)
  async createSpeech(
    @Body() body: unknown,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Uint8Array> {
    const reply = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        openAiSpeechClientContract,
        body,
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return replyWithMedia(reply, response);
  }

  /** JSON, or a multipart form with the images uploaded as files. */
  @Post("images/edits")
  @HttpCode(200)
  @UseInterceptors(FileFieldsInterceptor([...IMAGE_EDIT_FILE_FIELDS], MEDIA_UPLOAD_OPTIONS))
  async editImage(
    @Body() body: unknown,
    @UploadedFiles() files: ImageEditFiles | undefined,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Uint8Array> {
    const reply = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        openAiImageEditsClientContract,
        imageEditBodyOf(body, files),
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return replyWithMedia(reply, response);
  }

  /** JSON, or a multipart form with the first frame uploaded as a file. */
  @Post("videos")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor(VIDEO_FIRST_FRAME_FIELD, MEDIA_UPLOAD_OPTIONS))
  async createVideo(
    @Body() body: unknown,
    @UploadedFile() firstFrame: UploadedMediaFile | undefined,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Uint8Array> {
    const reply = await this.commandBus.execute(
      new SubmitVideoJobCommand(
        videoBodyOf(body, firstFrame),
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return replyWithMedia(reply, response);
  }

  @Get("videos/:videoId")
  retrieveVideo(
    @Param("videoId") videoId: string,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<unknown> {
    return this.queryBus.execute(
      new RetrieveVideoJobQuery(
        videoId,
        { kind: "api-key", principal },
        clientConnectionOf(request, response).signal,
      ),
    );
  }

  /** The MP4 streams through as it downloads (ADR 0028), so it gets a reply of its own. */
  @Get("videos/:videoId/content")
  downloadVideoContent(
    @Param("videoId") videoId: string,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Response> {
    return this.queryBus.execute(
      new DownloadVideoContentQuery(
        videoId,
        { kind: "api-key", principal },
        clientConnectionOf(request, response).signal,
      ),
    );
  }

  @Get("models")
  listModels(@CurrentUser() principal: ApiKeyPrincipal): Promise<ClientModelList> {
    return this.queryBus.execute(new ListClientModelsQuery(principal));
  }
}

/**
 * The reply Nest sends for `result`. A JSON body is already serialised, so it
 * goes out as those bytes, with the content type Nest gives a JSON reply.
 */
function replyWith(result: InferenceResult, response: ServerResponse): Uint8Array | Response {
  if (result.kind === "stream") {
    return eventStreamResponse(result.chunks);
  }
  response.setHeader("Content-Type", JSON_CONTENT_TYPE);
  return result.json;
}

function replyWithMedia(reply: MediaReply, response: ServerResponse): Uint8Array {
  response.setHeader("Content-Type", reply.contentType);
  return reply.body;
}
