import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import type { FinishReason } from '@/db/schemas';
import {
  anthropicMessagesFixture,
  type FakeReply,
  FakeUpstream,
  openAiChatFixture,
  openAiResponsesFixture,
} from '@tests/support/fake-upstream';
import {
  insertAnthropicMessagesModel,
  insertApiKey,
  insertOpenAiChatModel,
  insertOpenAiResponsesModel,
  type InsertedModel,
  type ModelOptions,
} from '@tests/support/inference';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';
import { writtenUsageLog } from '@tests/support/usage-logs';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');

const MODEL_NAME = 'smart';
const CHAT_REQUEST = {
  model: MODEL_NAME,
  messages: [{ role: 'user', content: 'Which umbrella should I pack for Lisbon?' }],
};
const TOOLS = [
  { type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } },
  { type: 'function', function: { name: 'get_time', parameters: { type: 'object' } } },
];
const PAUSE_BEFORE_OUTPUT_MS = 300;
const OPENING_CHUNK_WITHOUT_OUTPUT =
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1794700000,"model":"acme-large-2026","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}],"usage":{"prompt_tokens":12,"completion_tokens":0,"total_tokens":12}}\n\n';
const ANSWER_CHUNKS = [
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1794700000,"model":"acme-large-2026","choices":[{"index":0,"delta":{"content":"Pack a small one."},"finish_reason":"stop"}]}\n\n',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1794700000,"model":"acme-large-2026","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}\n\n',
  'data: [DONE]\n\n',
].join('');

type InsertModel = (
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
) => Promise<InsertedModel>;

interface SentParametersCase {
  protocol: string;
  insertModel: InsertModel;
  reply: FakeReply;
  sentParameters: {
    maxOutputTokens: number | null;
    reasoningEffort: string | null;
    thinkingBudgetTokens: number | null;
  };
}

interface FinishReasonCase {
  protocol: string;
  providerValue: string;
  insertModel: InsertModel;
  reply: FakeReply;
  finishReason: FinishReason;
}

function chatCompletionFinishingWith(finishReason: string): FakeReply {
  const body = JSON.parse(openAiChatFixture('upstream-response-tool-call.json'));
  body.choices[0].finish_reason = finishReason;
  return { kind: 'json', status: 200, body };
}

function anthropicMessageStoppingWith(stopReason: string): FakeReply {
  const body = JSON.parse(anthropicMessagesFixture('upstream-response-tool-call.json'));
  body.stop_reason = stopReason;
  return { kind: 'json', status: 200, body };
}

function incompleteResponse(reason: string): FakeReply {
  const body = JSON.parse(openAiResponsesFixture('upstream-response-tool-call.json'));
  body.status = 'incomplete';
  body.incomplete_details = { reason };
  return { kind: 'json', status: 200, body };
}

const FINISH_REASON_CASES: FinishReasonCase[] = [
  {
    protocol: 'openai-chat',
    providerValue: 'length',
    insertModel: insertOpenAiChatModel,
    reply: chatCompletionFinishingWith('length'),
    finishReason: 'length',
  },
  {
    protocol: 'openai-chat',
    providerValue: 'eos',
    insertModel: insertOpenAiChatModel,
    reply: chatCompletionFinishingWith('eos'),
    finishReason: 'other',
  },
  {
    protocol: 'anthropic-messages',
    providerValue: 'refusal',
    insertModel: insertAnthropicMessagesModel,
    reply: anthropicMessageStoppingWith('refusal'),
    finishReason: 'content_filter',
  },
  {
    protocol: 'anthropic-messages',
    providerValue: 'future_reason',
    insertModel: insertAnthropicMessagesModel,
    reply: anthropicMessageStoppingWith('future_reason'),
    finishReason: 'other',
  },
  {
    protocol: 'openai-responses',
    providerValue: 'max_output_tokens',
    insertModel: insertOpenAiResponsesModel,
    reply: incompleteResponse('max_output_tokens'),
    finishReason: 'length',
  },
];

const FORCED_EFFORT = 'high';
const FORCED_BUDGET_TOKENS = 3000;
const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;

const SENT_PARAMETERS_CASES: SentParametersCase[] = [
  {
    protocol: 'openai-chat',
    insertModel: insertOpenAiChatModel,
    reply: chatCompletionFinishingWith('stop'),
    sentParameters: {
      maxOutputTokens: null,
      reasoningEffort: FORCED_EFFORT,
      thinkingBudgetTokens: null,
    },
  },
  {
    protocol: 'openai-responses',
    insertModel: insertOpenAiResponsesModel,
    reply: {
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiResponsesFixture('upstream-response-tool-call.json')),
    },
    sentParameters: {
      maxOutputTokens: null,
      reasoningEffort: FORCED_EFFORT,
      thinkingBudgetTokens: null,
    },
  },
  {
    protocol: 'anthropic-messages',
    insertModel: insertAnthropicMessagesModel,
    reply: anthropicMessageStoppingWith('end_turn'),
    sentParameters: {
      maxOutputTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
      reasoningEffort: null,
      thinkingBudgetTokens: FORCED_BUDGET_TOKENS,
    },
  },
];

describe('Usage Logs: finish reason, sent limits, tools and Time to First Token (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let apiKey: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    usageQueue = app.get<Queue>(getQueueToken(USAGE_QUEUE));
    await usageQueue.obliterate({ force: true });
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await untilUsageQueueIsDrained(usageQueue);
    await deleteAllUpstreamData(db);
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  function chat(body: object) {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(body);
  }

  function insertChatModel() {
    return insertOpenAiChatModel(app, db, { modelName: MODEL_NAME, baseUrl: upstream.baseUrl });
  }

  it('records Time to First Token at the first output delta, not at an opening chunk without output', async () => {
    await insertChatModel();
    upstream.reply({
      kind: 'stream-in-pieces',
      pieces: [OPENING_CHUNK_WITHOUT_OUTPUT, ANSWER_CHUNKS],
      pauseMs: PAUSE_BEFORE_OUTPUT_MS,
    });

    await chat({ ...CHAT_REQUEST, stream: true }).expect(200);

    const usageLog = await writtenUsageLog(db);
    expect(usageLog.timeToFirstTokenMs).toBeGreaterThanOrEqual(PAUSE_BEFORE_OUTPUT_MS);
    expect(usageLog.finishReason).toBe('stop');
  });

  it.each(FINISH_REASON_CASES)(
    'maps the $protocol finish reason "$providerValue" to $finishReason',
    async ({ insertModel, reply, finishReason }) => {
      await insertModel(app, db, { modelName: MODEL_NAME, baseUrl: upstream.baseUrl });
      upstream.reply(reply);

      await chat(CHAT_REQUEST).expect(200);

      expect((await writtenUsageLog(db)).finishReason).toBe(finishReason);
    },
  );

  it('records the tools defined, the tool calls made and the streamed reasoning of a streamed request', async () => {
    await insertChatModel();
    upstream.reply({ kind: 'stream', events: openAiChatFixture('upstream-stream-tool-call.sse') });

    await chat({ ...CHAT_REQUEST, tools: TOOLS, stream: true }).expect(200);

    expect(await writtenUsageLog(db)).toMatchObject({
      toolCount: 2,
      toolCallCount: 1,
      finishReason: 'tool_calls',
      isReasoningStreamed: true,
      imageCount: null,
    });
  });

  it('records the tools defined and the tool calls made of a non-streamed request', async () => {
    await insertChatModel();
    upstream.reply(chatCompletionFinishingWith('tool_calls'));

    await chat({ ...CHAT_REQUEST, tools: TOOLS }).expect(200);

    expect(await writtenUsageLog(db)).toMatchObject({
      toolCount: 2,
      toolCallCount: 1,
      finishReason: 'tool_calls',
      isReasoningStreamed: false,
    });
  });

  it('records no tools and no limits for a request that sent none', async () => {
    await insertChatModel();
    upstream.reply(chatCompletionFinishingWith('stop'));

    await chat(CHAT_REQUEST).expect(200);

    expect(await writtenUsageLog(db)).toMatchObject({
      toolCount: 0,
      maxOutputTokens: null,
      reasoningEffort: null,
      thinkingBudgetTokens: null,
    });
  });

  it('leaves the finish reason empty when the stream broke after the upstream finished', async () => {
    await insertChatModel();
    const finishedChunks = openAiChatFixture('upstream-stream-tool-call.sse')
      .split('\n\n')
      .filter((chunk) => !chunk.includes('"usage"') && !chunk.includes('[DONE]'))
      .join('\n\n');
    upstream.reply({ kind: 'stream-then-reset', events: finishedChunks });

    await chat({ ...CHAT_REQUEST, stream: true }).expect(200);

    expect((await writtenUsageLog(db)).finishReason).toBeNull();
  });

  describe("under the Model's Parameter Policy", () => {
    let cookie: string;

    beforeEach(async () => {
      cookie = await setUpFirstUser(app, { email: 'ops@example.com', password: 'ops password' });
    });

    function saveModelPolicy(modelId: string, parameterPolicy: object) {
      return request(app.getHttpServer())
        .patch(`/api/models/${modelId}`)
        .set('Cookie', cookie)
        .send({ parameterPolicy })
        .expect(200);
    }

    function capModel(modelId: string, caps: object) {
      return saveModelPolicy(modelId, { caps });
    }

    function forceReasoning(modelId: string) {
      return saveModelPolicy(modelId, {
        forced: { reasoningEffort: FORCED_EFFORT, reasoningBudgetTokens: FORCED_BUDGET_TOKENS },
      });
    }

    it.each(SENT_PARAMETERS_CASES)(
      'records only the limits the $protocol Protocol puts on the wire',
      async ({ insertModel, reply, sentParameters }) => {
        const { modelId } = await insertModel(app, db, {
          modelName: MODEL_NAME,
          baseUrl: upstream.baseUrl,
        });
        await forceReasoning(modelId);
        upstream.reply(reply);

        await chat(CHAT_REQUEST).expect(200);

        expect(await writtenUsageLog(db)).toMatchObject(sentParameters);
      },
    );

    it('records the limits sent to an upstream that answered with an error', async () => {
      const { modelId } = await insertAnthropicMessagesModel(app, db, {
        modelName: MODEL_NAME,
        baseUrl: upstream.baseUrl,
      });
      await forceReasoning(modelId);
      upstream.reply({ kind: 'json', status: 500, body: { error: { message: 'overloaded' } } });

      await chat(CHAT_REQUEST);

      expect(await writtenUsageLog(db)).toMatchObject({
        maxOutputTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
        thinkingBudgetTokens: FORCED_BUDGET_TOKENS,
      });
    });

    it('records the output limit and reasoning effort sent upstream, not the ones the client asked for', async () => {
      const { modelId } = await insertChatModel();
      await capModel(modelId, { maxOutputTokens: 1024, reasoningEffort: 'low' });
      upstream.reply(chatCompletionFinishingWith('stop'));

      await chat({ ...CHAT_REQUEST, max_tokens: 4000, reasoning_effort: 'high' }).expect(200);

      expect(await writtenUsageLog(db)).toMatchObject({
        maxOutputTokens: 1024,
        reasoningEffort: 'low',
        thinkingBudgetTokens: null,
      });
    });

    it('records the thinking budget sent upstream, not the one the client asked for', async () => {
      const { modelId } = await insertAnthropicMessagesModel(app, db, {
        modelName: MODEL_NAME,
        baseUrl: upstream.baseUrl,
      });
      await capModel(modelId, { reasoningBudgetTokens: 2000 });
      upstream.reply(anthropicMessageStoppingWith('end_turn'));

      await request(app.getHttpServer())
        .post('/v1/messages')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          ...CHAT_REQUEST,
          max_tokens: 16000,
          thinking: { type: 'enabled', budget_tokens: 8000 },
        })
        .expect(200);

      expect(await writtenUsageLog(db)).toMatchObject({
        maxOutputTokens: 16000,
        thinkingBudgetTokens: 2000,
        finishReason: 'stop',
      });
    });
  });
});
