import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { CatalogProviderQuirks } from '@/catalog/schemas/catalog.schema';
import type { Database } from '@/db/schemas/relations';
import { FakeUpstream, openAiResponsesFixture } from '@tests/support/fake-upstream';
import {
  insertApiKey,
  insertOpenAiResponsesModel,
  setProviderQuirks,
  UPSTREAM_MODEL_ID,
} from '@tests/support/inference';
import { createTestApp } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const FIXTURE_CLIENT_REQUEST = {
  model: 'smart',
  messages: [
    { role: 'system', content: 'You are terse.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this picture, and what is the weather there?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ],
    },
    {
      role: 'assistant',
      content: null,
      reasoning_content: 'Need the weather.',
      tool_calls: [
        {
          id: 'call_abc123',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_abc123', content: '18°C, cloudy' },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Current weather for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    },
  ],
  tool_choice: 'auto',
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'answer',
      schema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
      strict: true,
    },
  },
  reasoning_effort: 'low',
  max_tokens: 512,
  temperature: 0.2,
  stream: true,
};

const ENCRYPTED_REASONING = 'gAAAAABencrypted-reasoning';

const CODEX_QUIRKS: CatalogProviderQuirks = {
  alwaysStreams: true,
  includesEncryptedReasoning: true,
  systemAsDeveloperMessage: true,
  droppedParameters: ['temperature', 'top_p', 'max_output_tokens'],
  acceptsPromptCacheKey: true,
};

interface ChatCompletionChunk {
  choices: {
    delta: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: { function: { arguments?: string } }[];
    };
  }[];
}

describe('An openai-responses upstream (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(app);
    ({ providerId } = await insertOpenAiResponsesModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function chat(body: object) {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(body);
  }

  function createResponse(body: object) {
    return request(app.getHttpServer())
      .post('/v1/responses')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(body);
  }

  function replyWithStream(): void {
    upstream.reply({
      kind: 'stream',
      events: openAiResponsesFixture('upstream-stream-tool-call.sse'),
    });
  }

  it("writes the recorded request to the Provider's responses URL, never asking it to store the response", async () => {
    replyWithStream();

    await chat(FIXTURE_CLIENT_REQUEST).expect(200);

    expect(upstream.lastRequest.path).toBe('/v1/responses');
    expect(upstream.lastRequest.headers['content-type']).toBe('application/json');
    expect(upstream.lastRequest.body).toEqual(
      JSON.parse(openAiResponsesFixture('upstream-request.json')),
    );
  });

  it('serves text, reasoning, a tool call and usage from a non-streaming response', async () => {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiResponsesFixture('upstream-response-tool-call.json')),
    });

    const response = await chat({ ...FIXTURE_CLIENT_REQUEST, stream: false }).expect(200);

    expect(upstream.lastRequest.body).not.toHaveProperty('stream');
    expect(response.body).toMatchObject({
      model: 'smart',
      choices: [
        {
          message: {
            content: 'Checking the weather.',
            reasoning_content: 'The user wants the weather in Paris.',
            tool_calls: [
              {
                id: 'call_def456',
                function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 100 },
        completion_tokens_details: { reasoning_tokens: 12 },
      },
    });
  });

  it("streams the upstream's events to a Chat Completions client as chunks, with usage", async () => {
    replyWithStream();

    const response = await chat({
      ...FIXTURE_CLIENT_REQUEST,
      stream_options: { include_usage: true },
    }).expect(200);

    const events = response.text.trim().split('\n\n');
    expect(events.at(-1)).toBe('data: [DONE]');
    const chunks: ChatCompletionChunk[] = events
      .slice(0, -1)
      .map((event) => JSON.parse(event.slice('data: '.length)));
    const deltas = chunks.flatMap((chunk) => chunk.choices.map((choice) => choice.delta));
    expect(deltas.map((delta) => delta.reasoning_content ?? '').join('')).toBe(
      'The user wants the weather in Paris.',
    );
    expect(deltas.map((delta) => delta.content ?? '').join('')).toBe('Checking the weather.');
    expect(
      deltas.flatMap((delta) => delta.tool_calls ?? []).map((call) => call.function.arguments),
    ).toEqual(['', '{"city":', '"Paris"}']);
    expect(chunks.at(-2)).toMatchObject({ choices: [{ finish_reason: 'tool_calls' }] });
    expect(chunks.at(-1)).toMatchObject({
      choices: [],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    });
  });

  it("streams the reasoning's encrypted content to a Responses client with its reasoning item", async () => {
    replyWithStream();

    const response = await createResponse({
      model: 'smart',
      input: 'Weather in Paris?',
      stream: true,
    }).expect(200);

    const doneItems = response.text
      .trim()
      .split('\n\n')
      .filter((block) => block.startsWith('event: response.output_item.done'))
      .map((block) => JSON.parse(block.slice(block.indexOf('data: ') + 'data: '.length)).item);
    expect(doneItems[0]).toMatchObject({
      type: 'reasoning',
      encrypted_content: ENCRYPTED_REASONING,
    });
  });

  it('hands encrypted reasoning to a Responses client and sends it back on the next turn', async () => {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiResponsesFixture('upstream-response-tool-call.json')),
    });
    const first = await createResponse({ model: 'smart', input: 'Weather in Paris?' }).expect(200);
    const reasoning = first.body.output[0];
    expect(reasoning).toMatchObject({ type: 'reasoning', encrypted_content: ENCRYPTED_REASONING });

    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiResponsesFixture('upstream-response-tool-call.json')),
    });
    await createResponse({
      model: 'smart',
      input: [{ role: 'user', content: 'Weather in Paris?' }, reasoning, first.body.output[2]],
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      input: [
        { type: 'message', role: 'user' },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'The user wants the weather in Paris.' }],
          encrypted_content: ENCRYPTED_REASONING,
        },
        { type: 'function_call', call_id: 'call_def456' },
      ],
    });
  });

  it('applies the Codex quirks: a stream gathered for a non-streaming client, the system prompt as a developer message, no sampling or output limit', async () => {
    await setProviderQuirks(app, db, providerId, CODEX_QUIRKS);
    replyWithStream();

    const response = await chat({ ...FIXTURE_CLIENT_REQUEST, stream: false }).expect(200);

    const sent = upstream.lastRequest.body;
    expect(sent).toMatchObject({
      model: UPSTREAM_MODEL_ID,
      input: [
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'You are terse.' }],
        },
        { type: 'message', role: 'user' },
        { type: 'function_call' },
        { type: 'function_call_output' },
      ],
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: expect.any(String),
      store: false,
      stream: true,
    });
    expect(sent).not.toHaveProperty('instructions');
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('top_p');
    expect(sent).not.toHaveProperty('max_output_tokens');
    expect(response.body).toMatchObject({
      choices: [
        {
          message: {
            content: 'Checking the weather.',
            reasoning_content: 'The user wants the weather in Paris.',
            tool_calls: [{ id: 'call_def456', function: { arguments: '{"city":"Paris"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    });
  });

  it('answers a response cut off by the output limit as truncated', async () => {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Partly' }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });

    const response = await chat({ ...FIXTURE_CLIENT_REQUEST, stream: false }).expect(200);

    expect(response.body.choices[0]).toMatchObject({
      message: { content: 'Partly' },
      finish_reason: 'length',
    });
  });

  it("ends the client's stream with an error event when the upstream's stream fails", async () => {
    const events = openAiResponsesFixture('upstream-stream-tool-call.sse').split('\n\n');
    upstream.reply({
      kind: 'stream',
      events: [
        ...events.slice(0, 5),
        'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"overloaded"}}}',
        '',
      ].join('\n\n'),
    });

    const response = await chat(FIXTURE_CLIENT_REQUEST).expect(200);

    expect(response.text).toContain('"reasoning_content":"The user wants"');
    expect(response.text.trim().split('\n\n').at(-1)).toContain('"code":"upstream_error"');
    expect(response.text).not.toContain('[DONE]');
  });
});
