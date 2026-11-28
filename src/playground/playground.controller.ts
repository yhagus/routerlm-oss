import type { IncomingMessage, ServerResponse } from 'node:http';
import { CurrentUser } from '@nestjs/authentication';
import {
  Body,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-node';
import { MEDIA_UPLOAD_OPTIONS, type MediaUpload } from '@/inference/models/media-upload';
import {
  TRANSCRIPTION_FILE_FIELD,
  transcriptionBodyOf,
} from '@/inference/protocols/openai-transcription/openai-transcription-form';
import {
  IMAGE_EDIT_FILE_FIELDS,
  type ImageEditFiles,
  imageEditBodyOf,
} from '@/inference/protocols/openai-images/openai-image-edits-form';
import {
  openAiImageEditsClientContract,
  openAiImagesClientContract,
} from '@/inference/protocols/openai-images/openai-images-client-contract';
import { DownloadVideoContentQuery } from '@/inference/queries/impl/download-video-content.query';
import { RetrieveVideoJobQuery } from '@/inference/queries/impl/retrieve-video-job.query';
import { DashboardController } from '@/auth/decorators/dashboard-controller.decorator';
import { clientConnectionOf } from '@/libs/models/client-connection';
import { eventStreamResponse } from '@/libs/models/event-stream-response';
import type { User } from '@/users/models/user';
import { PlaygroundExceptionFilter } from './filters/playground-exception.filter';
import { type PlaygroundRequest, playgroundRequestSchema } from './schemas/playground.schema';
import { SendPlaygroundChatCompletionCommand } from './commands/impl/send-playground-chat-completion.command';
import { SendPlaygroundImageGenerationCommand } from './commands/impl/send-playground-image-generation.command';
import { SendPlaygroundSpeechCommand } from './commands/impl/send-playground-speech.command';
import { SendPlaygroundVideoJobCommand } from './commands/impl/send-playground-video-job.command';
import type { PlaygroundImageGeneration } from './models/playground-image-generation';
import type { PlaygroundSpeech } from './models/playground-speech';
import { SendPlaygroundTranscriptionCommand } from './commands/impl/send-playground-transcription.command';
import type { PlaygroundTranscription } from './models/playground-transcription';
import type { PlaygroundVideoJob } from './models/playground-video-job';
import { ProbeUpstreamModelCommand } from './commands/impl/probe-upstream-model.command';
import type { ProbeResults } from './models/probe-result';

@DashboardController('playground')
@UseFilters(PlaygroundExceptionFilter)
export class PlaygroundController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('chat/completions')
  @HttpCode(200)
  async sendChatCompletion(
    @Body({ schema: playgroundRequestSchema }) body: PlaygroundRequest,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Response> {
    const chunks = await this.commandBus.execute(
      new SendPlaygroundChatCompletionCommand(body, user, clientConnectionOf(request, response), {
        kind: 'named-model',
      }),
    );
    return eventStreamResponse(chunks);
  }

  @Post('upstream-models/:upstreamModelId/chat/completions')
  @HttpCode(200)
  async sendChatCompletionToUpstreamModel(
    @Param('upstreamModelId', ParseUUIDPipe) upstreamModelId: string,
    @Body({ schema: playgroundRequestSchema }) body: PlaygroundRequest,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Response> {
    const chunks = await this.commandBus.execute(
      new SendPlaygroundChatCompletionCommand(body, user, clientConnectionOf(request, response), {
        kind: 'upstream-model',
        upstreamModelId,
      }),
    );
    return eventStreamResponse(chunks);
  }

  @Post('images/generations')
  @HttpCode(200)
  generateImage(
    @Body() body: unknown,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundImageGeneration> {
    return this.commandBus.execute(
      new SendPlaygroundImageGenerationCommand(
        openAiImagesClientContract,
        body,
        user,
        clientConnectionOf(request, response),
        { kind: 'named-model' },
      ),
    );
  }

  @Post('upstream-models/:upstreamModelId/images/generations')
  @HttpCode(200)
  generateImageWithUpstreamModel(
    @Param('upstreamModelId', ParseUUIDPipe) upstreamModelId: string,
    @Body() body: unknown,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundImageGeneration> {
    return this.commandBus.execute(
      new SendPlaygroundImageGenerationCommand(
        openAiImagesClientContract,
        body,
        user,
        clientConnectionOf(request, response),
        { kind: 'upstream-model', upstreamModelId },
      ),
    );
  }

  @Post('images/edits')
  @HttpCode(200)
  @UseInterceptors(FileFieldsInterceptor([...IMAGE_EDIT_FILE_FIELDS], MEDIA_UPLOAD_OPTIONS))
  editImage(
    @Body() body: unknown,
    @UploadedFiles() files: ImageEditFiles | undefined,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundImageGeneration> {
    return this.commandBus.execute(
      new SendPlaygroundImageGenerationCommand(
        openAiImageEditsClientContract,
        imageEditBodyOf(body, files),
        user,
        clientConnectionOf(request, response),
        { kind: 'named-model' },
      ),
    );
  }

  @Post('upstream-models/:upstreamModelId/images/edits')
  @HttpCode(200)
  @UseInterceptors(FileFieldsInterceptor([...IMAGE_EDIT_FILE_FIELDS], MEDIA_UPLOAD_OPTIONS))
  editImageWithUpstreamModel(
    @Param('upstreamModelId', ParseUUIDPipe) upstreamModelId: string,
    @Body() body: unknown,
    @UploadedFiles() files: ImageEditFiles | undefined,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundImageGeneration> {
    return this.commandBus.execute(
      new SendPlaygroundImageGenerationCommand(
        openAiImageEditsClientContract,
        imageEditBodyOf(body, files),
        user,
        clientConnectionOf(request, response),
        { kind: 'upstream-model', upstreamModelId },
      ),
    );
  }

  @Post('audio/speech')
  @HttpCode(200)
  synthesizeSpeech(
    @Body() body: unknown,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundSpeech> {
    return this.commandBus.execute(
      new SendPlaygroundSpeechCommand(body, user, clientConnectionOf(request, response), {
        kind: 'named-model',
      }),
    );
  }

  @Post('upstream-models/:upstreamModelId/audio/speech')
  @HttpCode(200)
  synthesizeSpeechWithUpstreamModel(
    @Param('upstreamModelId', ParseUUIDPipe) upstreamModelId: string,
    @Body() body: unknown,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundSpeech> {
    return this.commandBus.execute(
      new SendPlaygroundSpeechCommand(body, user, clientConnectionOf(request, response), {
        kind: 'upstream-model',
        upstreamModelId,
      }),
    );
  }

  @Post('videos')
  @HttpCode(200)
  submitVideoJob(
    @Body() body: unknown,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundVideoJob> {
    return this.commandBus.execute(
      new SendPlaygroundVideoJobCommand(body, user, clientConnectionOf(request, response), {
        kind: 'named-model',
      }),
    );
  }

  @Post('upstream-models/:upstreamModelId/videos')
  @HttpCode(200)
  submitVideoJobToUpstreamModel(
    @Param('upstreamModelId', ParseUUIDPipe) upstreamModelId: string,
    @Body() body: unknown,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundVideoJob> {
    return this.commandBus.execute(
      new SendPlaygroundVideoJobCommand(body, user, clientConnectionOf(request, response), {
        kind: 'upstream-model',
        upstreamModelId,
      }),
    );
  }

  @Get('videos/:videoId')
  retrieveVideoJob(
    @Param('videoId') videoId: string,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<unknown> {
    return this.queryBus.execute(
      new RetrieveVideoJobQuery(
        videoId,
        { kind: 'playground', userId: user.id, userEmail: user.email },
        clientConnectionOf(request, response).signal,
      ),
    );
  }

  @Get('videos/:videoId/content')
  downloadVideoContent(
    @Param('videoId') videoId: string,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<Response> {
    return this.queryBus.execute(
      new DownloadVideoContentQuery(
        videoId,
        { kind: 'playground', userId: user.id, userEmail: user.email },
        clientConnectionOf(request, response).signal,
      ),
    );
  }

  @Post('audio/transcriptions')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor(TRANSCRIPTION_FILE_FIELD, MEDIA_UPLOAD_OPTIONS))
  transcribeAudio(
    @Body() body: unknown,
    @UploadedFile() file: MediaUpload | undefined,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundTranscription> {
    return this.commandBus.execute(
      new SendPlaygroundTranscriptionCommand(
        transcriptionBodyOf(body, file),
        user,
        clientConnectionOf(request, response),
        { kind: 'named-model' },
      ),
    );
  }

  @Post('upstream-models/:upstreamModelId/audio/transcriptions')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor(TRANSCRIPTION_FILE_FIELD, MEDIA_UPLOAD_OPTIONS))
  transcribeAudioWithUpstreamModel(
    @Param('upstreamModelId', ParseUUIDPipe) upstreamModelId: string,
    @Body() body: unknown,
    @UploadedFile() file: MediaUpload | undefined,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PlaygroundTranscription> {
    return this.commandBus.execute(
      new SendPlaygroundTranscriptionCommand(
        transcriptionBodyOf(body, file),
        user,
        clientConnectionOf(request, response),
        { kind: 'upstream-model', upstreamModelId },
      ),
    );
  }

  @Post('upstream-models/:upstreamModelId/probe')
  @HttpCode(200)
  probeUpstreamModel(
    @Param('upstreamModelId', ParseUUIDPipe) upstreamModelId: string,
    @CurrentUser() user: User,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<ProbeResults> {
    return this.commandBus.execute(
      new ProbeUpstreamModelCommand(upstreamModelId, user, clientConnectionOf(request, response)),
    );
  }
}
