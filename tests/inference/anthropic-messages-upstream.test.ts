import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { anthropicMessagesFixture, FakeUpstream } from '@tests/support/fake-upstream';
import {
  ALL_CAPABILITIES,
  insertAnthropicMessagesModel,
  insertApiKey,
  UPSTREAM_KEY,
  UPSTREAM_MODEL_ID,
} from '@tests/support/inference';
import { createTestApp } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const TOOL_RESULT_TURN_REQUEST = {
  model: 'smart',
  messages: [
    { role: 'system', content: 'You are terse.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is the weather where this was taken?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ],
    },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'toolu_00first',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'toolu_00first', content: '18°C, cloudy' },
    { role: 'user', content: 'And tomorrow?' },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'answer',
      schema: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  reasoning_effort: 'low',
};

const SIGNATURE = 'EqQBCgIYAhIM1gbcDa9GJwZA2b3h';
const CITY_PARAMETERS = { type: 'object', properties: { city: { type: 'string' } } };

const FIXTURE_CLIENT_REQUEST = {
  model: 'smart',
  max_tokens: 512,
  system: [{ type: 'text', text: 'You are terse.', cache_control: { type: 'ephemeral' } }],
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this picture, and what is the weather and time there?' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
        },
        { type: 'image', source: { type: 'url', url: 'https://images.acme.example/paris.jpg' } },
      ],
    },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Need the weather and the time.', signature: SIGNATURE },
        { type: 'thinking', thinking: 'Thought from an openai-chat Provider.', signature: '' },
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'toolu_01weather', name: 'get_weather', input: { city: 'Paris' } },
        { type: 'tool_use', id: 'toolu_02time', name: 'get_time', input: { city: 'Paris' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_01weather', content: '18°C, cloudy' },
        { type: 'tool_result', tool_use_id: 'toolu_02time', content: '14:00' },
        {
          type: 'text',
          text: 'Answer as JSON.',
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
    },
  ],
  tools: [
    {
      name: 'get_weather',
      description: 'Current weather for a city',
      input_schema: { ...CITY_PARAMETERS, required: ['city'] },
      strict: true,
    },
    { name: 'get_time', input_schema: CITY_PARAMETERS, cache_control: { type: 'ephemeral' } },
  ],
  tool_choice: { type: 'auto', disable_parallel_tool_use: true },
  thinking: { type: 'adaptive' },
  output_config: {
    effort: 'low',
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  },
  stop_sequences: ['END'],
  stream: true,
};

const HELLO_REQUEST = {
  model: 'smart',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'Hello' }],
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

describe('An anthropic-messages upstream (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    await insertAnthropicMessagesModel(app, db, {
      modelName: 'smart',
      baseUrl: new URL(upstream.baseUrl).origin,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function createMessage(body: object) {
    return request(app.getHttpServer()).post('/v1/messages').set('x-api-key', apiKey).send(body);
  }

  function replyWithMessage(fields: object = {}): void {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: {
        ...JSON.parse(anthropicMessagesFixture('upstream-response-tool-call.json')),
        ...fields,
      },
    });
  }

  function chat(body: object) {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(body);
  }

  it('translates images, tool results, reasoning and a JSON schema from Chat Completions to Anthropic Messages and back', async () => {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(anthropicMessagesFixture('upstream-response-tool-call.json')),
    });

    const response = await chat(TOOL_RESULT_TURN_REQUEST).expect(200);

    expect(upstream.lastRequest.path).toBe('/v1/messages');
    expect(upstream.lastRequest.headers['x-api-key']).toBe(UPSTREAM_KEY);
    expect(upstream.lastRequest.headers).not.toHaveProperty('authorization');
    expect(upstream.lastRequest.headers['anthropic-version']).toBe('2023-06-01');
    expect(upstream.lastRequest.body).toMatchObject({
      model: UPSTREAM_MODEL_ID,
      system: [{ type: 'text', text: 'You are terse.' }],
      messages: [
        { role: 'user', content: [{ type: 'text' }, { type: 'image' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_00first', input: { city: 'Paris' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_00first' },
            { type: 'text', text: 'And tomorrow?' },
          ],
        },
      ],
      tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(response.body).toMatchObject({
      model: 'smart',
      choices: [
        {
          message: {
            content: 'Checking the weather.',
            reasoning_content: 'The user wants the weather in Paris.',
            tool_calls: [
              {
                id: 'toolu_01weather',
                function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 150, completion_tokens: 40 },
    });
  });

  it("streams the upstream's named events to a Chat Completions client as chunks", async () => {
    upstream.reply({
      kind: 'stream',
      events: anthropicMessagesFixture('upstream-stream-tool-call.sse'),
    });

    const response = await chat({
      ...TOOL_RESULT_TURN_REQUEST,
      stream: true,
      stream_options: { include_usage: true },
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ stream: true });
    const events = response.text.trim().split('\n\n');
    expect(events.at(-1)).toBe('data: [DONE]');
    const chunks: ChatCompletionChunk[] = events
      .slice(0, -1)
      .map((event) => JSON.parse(event.slice('data: '.length)));
    const deltas = chunks.flatMap((chunk) => chunk.choices.map((choice) => choice.delta));
    expect(deltas.map((delta) => delta.reasoning_content ?? '').join('')).toBe('Paris weather.');
    expect(deltas.map((delta) => delta.content ?? '').join('')).toBe('Checking.');
    expect(
      deltas.flatMap((delta) => delta.tool_calls ?? []).map((call) => call.function.arguments),
    ).toEqual(['', '{"city":', '"Paris"}']);
    expect(chunks.at(-2)).toMatchObject({ choices: [{ finish_reason: 'tool_calls' }] });
    expect(chunks.at(-1)).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 150, completion_tokens: 40 },
    });
  });

  it("writes the recorded request to the Provider's messages URL, in a fixed key order", async () => {
    upstream.reply({
      kind: 'stream',
      events: anthropicMessagesFixture('upstream-stream-tool-call.sse'),
    });

    await createMessage(FIXTURE_CLIENT_REQUEST).expect(200);

    expect(upstream.lastRequest.path).toBe('/v1/messages');
    expect(upstream.lastRequest.headers['content-type']).toBe('application/json');
    expect(upstream.lastRequest.rawBody).toBe(
      JSON.stringify({
        ...JSON.parse(anthropicMessagesFixture('upstream-request.json')),
        model: UPSTREAM_MODEL_ID,
      }),
    );
  });

  it('writes byte-identical bodies for the same request', async () => {
    replyWithMessage();
    replyWithMessage();
    const nonStreaming = { ...FIXTURE_CLIENT_REQUEST, stream: false };

    await createMessage(nonStreaming).expect(200);
    await createMessage(nonStreaming).expect(200);

    const [first, second] = upstream.requests;
    expect(second.rawBody).toBe(first.rawBody);
  });

  it("asks for the Upstream Model's max output when the client set no limit", async () => {
    await insertAnthropicMessagesModel(app, db, {
      modelName: 'capped',
      baseUrl: new URL(upstream.baseUrl).origin,
      capabilities: ALL_CAPABILITIES,
      maxOutputTokens: 64_000,
    });
    replyWithMessage();

    await chat({ model: 'capped', messages: [{ role: 'user', content: 'Hello' }] }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ max_tokens: 64_000 });
  });

  it('sends a thinking budget as one, without an effort level', async () => {
    replyWithMessage();

    await createMessage({
      ...HELLO_REQUEST,
      thinking: { type: 'enabled', budget_tokens: 2048 },
      output_config: { effort: 'high' },
    }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      thinking: { type: 'enabled', budget_tokens: 2048 },
    });
    expect(upstream.lastRequest.body).not.toHaveProperty('output_config');
  });

  it.each([
    ['end_turn', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['model_context_window_exceeded', 'max_tokens'],
    ['stop_sequence', 'stop_sequence'],
    ['refusal', 'refusal'],
    ['pause_turn', 'end_turn'],
  ])("answers the upstream's stop reason %s as %s", async (upstreamStopReason, stopReason) => {
    replyWithMessage({ stop_reason: upstreamStopReason });

    const response = await createMessage(HELLO_REQUEST).expect(200);

    expect(response.body.stop_reason).toBe(stopReason);
  });

  it("answers 502 upstream_error when the upstream's body is not a message", async () => {
    upstream.reply({ kind: 'json', status: 200, body: { result: 'ok' } });

    const response = await createMessage(HELLO_REQUEST).expect(502);

    expect(response.body.error.code).toBe('upstream_error');
  });

  function streamUpToFirstText(): string {
    const events = anthropicMessagesFixture('upstream-stream-tool-call.sse').split('\n\n');
    const firstText = events.findIndex((event) => event.includes('"text_delta"'));
    return `${events.slice(0, firstText + 1).join('\n\n')}\n\n`;
  }

  it('skips a delta type it does not read and finishes the stream', async () => {
    const fixture = anthropicMessagesFixture('upstream-stream-tool-call.sse');
    const head = streamUpToFirstText();
    const unreadDelta =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"citations_delta","citation":{"type":"char_location"}}}\n\n';
    upstream.reply({ kind: 'stream', events: head + unreadDelta + fixture.slice(head.length) });

    const response = await createMessage({ ...HELLO_REQUEST, stream: true }).expect(200);

    expect(response.text).toContain('"text":"Checking."');
    expect(response.text).not.toContain('citation');
    expect(response.text.trim().split('\n\n').at(-1)).toContain('message_stop');
  });

  it.each([
    [
      'reports an error',
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    ],
    ['ends before message_stop', ''],
  ])(
    "ends the client's stream with an error event when the upstream's stream %s",
    async (_case, ending) => {
      upstream.reply({ kind: 'stream', events: streamUpToFirstText() + ending });

      const response = await createMessage({ ...HELLO_REQUEST, stream: true }).expect(200);

      expect(response.text).toContain('"text":"Checking."');
      expect(response.text.trim().split('\n\n').at(-1)).toMatch(
        /^event: error\ndata: \{"type":"error","error":\{.*"code":"upstream_error"/,
      );
      expect(response.text).not.toContain('message_stop');
    },
  );
});
