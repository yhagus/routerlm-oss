import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  FetchedMedia,
  MediaExchange,
  MediaUpstreamTarget,
} from '@/inference/models/media-kind';
import { dashScopeImageProtocol } from '@/inference/protocols/dashscope-image/dashscope-image-protocol';
import { dashScopeSpeechProtocol } from '@/inference/protocols/dashscope-speech/dashscope-speech-protocol';
import { dashScopeTranscriptionProtocol } from '@/inference/protocols/dashscope-transcription/dashscope-transcription-protocol';
import { dashScopeVideoProtocol } from '@/inference/protocols/dashscope-video/dashscope-video-protocol';

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
  console.error('Set DASHSCOPE_API_KEY to a DashScope key. Every run is billed.');
  process.exit(1);
}
const baseUrl = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/api/v1';
const withVideo = process.argv.includes('--video');
const PROTOCOLS_DIR = 'src/inference/protocols';
const VIDEO_POLL_MS = 10_000;
const VIDEO_TIMEOUT_MS = 10 * 60_000;

function save(protocolDir: string, name: string, body: unknown): void {
  const path = join(PROTOCOLS_DIR, protocolDir, 'fixtures', 'recorded', `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`  saved ${path}`);
}

async function answerOf(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  const answer: unknown = JSON.parse(text);
  return answer;
}

function recordingExchange(protocolDir: string, names: string[]): MediaExchange {
  const authorization = { Authorization: `Bearer ${apiKey}` };
  const record = (body: unknown): unknown => {
    save(protocolDir, names.shift() ?? `extra-${Date.now()}`, body);
    return body;
  };
  return {
    async postJson(url, body, headers) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      return record(await answerOf(response));
    },
    async getJson(url) {
      return record(await answerOf(await fetch(url, { headers: authorization })));
    },
    async fetchMedia(url): Promise<FetchedMedia> {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`media fetch HTTP ${response.status}`);
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      };
    },
  };
}

function targetOf(upstreamModelId: string): MediaUpstreamTarget {
  return { baseUrl, upstreamModelId, isWatermarked: false };
}

async function check(label: string, run: () => Promise<string>): Promise<boolean> {
  console.log(`${label}:`);
  try {
    console.log(`  ok: ${await run()}`);
    return true;
  } catch (error) {
    console.log(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

const outcomes: boolean[] = [];

outcomes.push(
  await check('dashscope-image, qwen-image-3.0-pro', async () => {
    const outcome = await dashScopeImageProtocol.generate(
      {
        model: 'qwen-image-3.0-pro',
        prompt: 'A red apple on a white table',
        n: 1,
        size: { width: 1328, height: 1328 },
        negativePrompt: null,
        seed: null,
        inputImages: [],
      },
      targetOf('qwen-image-3.0-pro'),
      recordingExchange('dashscope-image', ['generation']),
    );
    return `${outcome.result.images.length} image(s), units ${JSON.stringify(outcome.units)}`;
  }),
);

let spokenAudio: FetchedMedia | undefined;
outcomes.push(
  await check('dashscope-speech, qwen-audio-3.0-tts-plus', async () => {
    const outcome = await dashScopeSpeechProtocol.generate(
      {
        model: 'qwen-audio-3.0-tts-plus',
        text: 'Hello from the gateway.',
        voice: 'Cherry',
        format: 'mp3',
        speed: null,
      },
      targetOf('qwen-audio-3.0-tts-plus'),
      recordingExchange('dashscope-speech', ['synthesis']),
    );
    spokenAudio = outcome.result.audio;
    return `${outcome.result.audio.bytes.length} bytes of ${outcome.result.audio.contentType}, units ${JSON.stringify(outcome.units)}`;
  }),
);

outcomes.push(
  await check('qwen-audio-3.0-tts-plus with input.instruction (raw probe)', async () => {
    const answer = await recordingExchange('dashscope-speech', ['probe-instruction']).postJson(
      `${baseUrl}/services/audio/tts/SpeechSynthesizer`,
      {
        model: 'qwen-audio-3.0-tts-plus',
        input: {
          text: 'Hello from the gateway.',
          voice: 'Cherry',
          format: 'mp3',
          instruction: 'Speak slowly and cheerfully.',
        },
      },
    );
    return `accepted; compare the saved answer and audio with the plain call (${JSON.stringify(answer).slice(0, 120)}...)`;
  }),
);

outcomes.push(
  await check('dashscope-transcription, qwen-audio-3.0-asr-flash', async () => {
    if (!spokenAudio) {
      throw new Error("skipped: needs the speech check's audio");
    }
    const outcome = await dashScopeTranscriptionProtocol.generate(
      {
        model: 'qwen-audio-3.0-asr-flash',
        audio: {
          dataUri: `data:audio/mpeg;base64,${Buffer.from(spokenAudio.bytes).toString('base64')}`,
          format: 'mp3',
        },
        language: 'en',
        responseFormat: 'json',
      },
      targetOf('qwen-audio-3.0-asr-flash'),
      recordingExchange('dashscope-transcription', ['transcription']),
    );
    return `heard "${outcome.result.text}", units ${JSON.stringify(outcome.units)}`;
  }),
);

if (withVideo) {
  outcomes.push(
    await check('dashscope-video, happyhorse-1.1-t2v at 3 s 480P', async () => {
      const target = targetOf('happyhorse-1.1-t2v');
      const names = ['create'];
      const exchange = recordingExchange('dashscope-video', names);
      const submitted = await dashScopeVideoProtocol.generate(
        {
          model: 'happyhorse-1.1-t2v',
          prompt: 'A paper boat drifting on a calm lake',
          seconds: 3,
          resolution: '480P',
          ratio: '16:9',
          clientSize: null,
          media: [],
          seed: null,
        },
        target,
        exchange,
      );
      const deadline = Date.now() + VIDEO_TIMEOUT_MS;
      while (Date.now() < deadline) {
        names.push('task-latest');
        const state = await dashScopeVideoProtocol.readTask(
          submitted.result.taskId,
          target,
          exchange,
        );
        if (state.status !== 'queued' && state.status !== 'in_progress') {
          return `task ${submitted.result.taskId} ended ${state.status}`;
        }
        await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_MS));
      }
      throw new Error(`task ${submitted.result.taskId} still running after 10 minutes`);
    }),
  );
} else {
  console.log('dashscope-video: skipped (pass --video; a Video Job costs more).');
}

process.exit(outcomes.every(Boolean) ? 0 : 1);
