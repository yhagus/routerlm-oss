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
import type { ApiKeyPrincipal } from "@/api-keys/models/api-key";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth";
import { clientConnectionOf } from "@/libs/models/client-connection";
import { eventStreamResponse } from "@/libs/models/event-stream-response";
import type { ClientModelList } from "./models/client-model";
import type { InferenceResult } from "./models/inference";
import type { MediaReply } from "./models/media-kind";
import { RunInferenceCommand } from "./commands/impl/run-inference.command";
import { RunMediaInferenceCommand } from "./commands/impl/run-media-inference.command";
import { SubmitVideoJobCommand } from "./commands/impl/submit-video-job.command";
import { DownloadVideoContentQuery } from "./queries/impl/download-video-content.query";
import { ListClientModelsQuery } from "./queries/impl/list-client-models.query";
import { RetrieveVideoJobQuery } from "./queries/impl/retrieve-video-job.query";
import { anthropicMessagesClientConverter } from "./protocols/anthropic-messages/anthropic-messages-client-converter";
import { openAiChatClientConverter } from "./protocols/openai-chat/openai-chat-client-converter";
import { MEDIA_UPLOAD_OPTIONS, type MediaUpload } from "./models/media-upload";
import {
  IMAGE_EDIT_FILE_FIELDS,
  type ImageEditFiles,
  imageEditBodyOf,
} from "./protocols/openai-images/openai-image-edits-form";
import {
  openAiImageEditsClientContract,
  openAiImagesClientContract,
} from "./protocols/openai-images/openai-images-client-contract";
import { VIDEO_FIRST_FRAME_FIELD, videoBodyOf } from "./protocols/openai-videos/openai-video-form";
import { openAiSpeechClientContract } from "./protocols/openai-speech/openai-speech-client-contract";
import {
  TRANSCRIPTION_FILE_FIELD,
  transcriptionBodyOf,
} from "./protocols/openai-transcription/openai-transcription-form";
import { openAiTranscriptionClientContract } from "./protocols/openai-transcription/openai-transcription-client-contract";
import { openAiResponsesClientConverter } from "./protocols/openai-responses/openai-responses-client-converter";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export const INFERENCE_API_PREFIX = "v1";

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

  @Post("audio/transcriptions")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor(TRANSCRIPTION_FILE_FIELD, MEDIA_UPLOAD_OPTIONS))
  async createTranscription(
    @Body() body: unknown,
    @UploadedFile() file: MediaUpload | undefined,
    @CurrentUser() principal: ApiKeyPrincipal,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Uint8Array> {
    const reply = await this.commandBus.execute(
      new RunMediaInferenceCommand(
        openAiTranscriptionClientContract,
        transcriptionBodyOf(body, file),
        { kind: "api-key", principal },
        clientConnectionOf(request, response),
      ),
    );
    return replyWithMedia(reply, response);
  }

  @Post("videos")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor(VIDEO_FIRST_FRAME_FIELD, MEDIA_UPLOAD_OPTIONS))
  async createVideo(
    @Body() body: unknown,
    @UploadedFile() firstFrame: MediaUpload | undefined,
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
