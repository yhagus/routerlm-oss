import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT ?? 4000);
const LATENCY_MS = Number(process.env.UPSTREAM_LATENCY_MS ?? 200);
const TOKENS_PER_SECOND = Number(process.env.TOKENS_PER_SECOND ?? 100);
const OUTPUT_TOKENS = Number(process.env.OUTPUT_TOKENS ?? 200);
const INSTANT_OUTPUT_TOKENS = Number(process.env.INSTANT_OUTPUT_TOKENS ?? 20);
const MODEL = 'perf-upstream-model';
const TEXT = 'word ';
const INPUT_TOKENS = 20;

const SLOW_MARKER = '[perf:slow]';
const LONG_STREAM_MARKER = '[perf:long-stream]';
const SLOW_LATENCY_MS = 10_000;
const LONG_STREAM_TOKENS = 2000;
const LONG_STREAM_DELAY_MS = 5;
const FLAP_FAILS_PER_10 = 3;

const sse = (event, data) =>
  (event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`;

const chat = {
  json: (tokens) => ({
    id: 'chatcmpl-perf',
    object: 'chat.completion',
    created: 1794700000,
    model: MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: TEXT.repeat(tokens) },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: INPUT_TOKENS,
      completion_tokens: tokens,
      total_tokens: INPUT_TOKENS + tokens,
    },
  }),
  start: () => '',
  delta: (ctx, i) =>
    sse(null, {
      id: 'chatcmpl-perf',
      object: 'chat.completion.chunk',
      created: 1794700000,
      model: MODEL,
      choices: [
        {
          index: 0,
          delta: i === 0 ? { role: 'assistant', content: TEXT } : { content: TEXT },
          finish_reason: null,
        },
      ],
    }),
  end: (ctx, tokens) =>
    sse(null, {
      id: 'chatcmpl-perf',
      object: 'chat.completion.chunk',
      created: 1794700000,
      model: MODEL,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }) +
    sse(null, {
      id: 'chatcmpl-perf',
      object: 'chat.completion.chunk',
      created: 1794700000,
      model: MODEL,
      choices: [],
      usage: {
        prompt_tokens: INPUT_TOKENS,
        completion_tokens: tokens,
        total_tokens: INPUT_TOKENS + tokens,
      },
    }) +
    'data: [DONE]\n\n',
};

const messages = {
  json: (tokens) => ({
    id: 'msg_perf',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [{ type: 'text', text: TEXT.repeat(tokens) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: INPUT_TOKENS, output_tokens: tokens },
  }),
  start: () =>
    sse('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_perf',
        type: 'message',
        role: 'assistant',
        model: MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: INPUT_TOKENS, output_tokens: 1 },
      },
    }) +
    sse('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
  delta: () =>
    sse('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: TEXT },
    }),
  end: (ctx, tokens) =>
    sse('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: tokens },
    }) +
    sse('message_stop', { type: 'message_stop' }),
};

const responseBody = (status, output, usage) => ({
  id: 'resp_perf',
  object: 'response',
  created_at: 1794700000,
  model: MODEL,
  store: false,
  status,
  output,
  usage,
});
const responsesMessage = (status, content) => ({
  id: 'msg_perf',
  type: 'message',
  status,
  role: 'assistant',
  content,
});
const responsesUsage = (tokens) => ({
  input_tokens: INPUT_TOKENS,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: tokens,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: INPUT_TOKENS + tokens,
});

const responses = {
  json: (tokens) =>
    responseBody(
      'completed',
      [
        responsesMessage('completed', [
          { type: 'output_text', text: TEXT.repeat(tokens), annotations: [] },
        ]),
      ],
      responsesUsage(tokens),
    ),
  start: (ctx) =>
    sse('response.created', {
      type: 'response.created',
      sequence_number: ctx.seq++,
      response: responseBody('in_progress', [], null),
    }) +
    sse('response.output_item.added', {
      type: 'response.output_item.added',
      sequence_number: ctx.seq++,
      output_index: 0,
      item: responsesMessage('in_progress', []),
    }) +
    sse('response.content_part.added', {
      type: 'response.content_part.added',
      sequence_number: ctx.seq++,
      item_id: 'msg_perf',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    }),
  delta: (ctx) =>
    sse('response.output_text.delta', {
      type: 'response.output_text.delta',
      sequence_number: ctx.seq++,
      item_id: 'msg_perf',
      output_index: 0,
      content_index: 0,
      delta: TEXT,
    }),
  end: (ctx, tokens) => {
    const text = TEXT.repeat(tokens);
    const part = { type: 'output_text', text, annotations: [] };
    const item = responsesMessage('completed', [part]);
    return (
      sse('response.output_text.done', {
        type: 'response.output_text.done',
        sequence_number: ctx.seq++,
        item_id: 'msg_perf',
        output_index: 0,
        content_index: 0,
        text,
      }) +
      sse('response.content_part.done', {
        type: 'response.content_part.done',
        sequence_number: ctx.seq++,
        item_id: 'msg_perf',
        output_index: 0,
        content_index: 0,
        part,
      }) +
      sse('response.output_item.done', {
        type: 'response.output_item.done',
        sequence_number: ctx.seq++,
        output_index: 0,
        item,
      }) +
      sse('response.completed', {
        type: 'response.completed',
        sequence_number: ctx.seq++,
        response: responseBody('completed', [item], responsesUsage(tokens)),
      })
    );
  },
};

const PROTOCOLS = { 'chat/completions': chat, messages, responses };

function targetOf(url) {
  const path = url.split('?')[0];
  const parts = path.split('/').filter(Boolean);
  const mode = parts[0];
  const fault = mode === 'fault' ? parts[1] : null;
  const endpoint = Object.keys(PROTOCOLS).find((suffix) => path.endsWith(`/${suffix}`));
  return { mode, fault, protocol: endpoint ? PROTOCOLS[endpoint] : undefined };
}

function planOf(mode, raw) {
  const plan =
    mode === 'instant'
      ? { latencyMs: 0, tokens: INSTANT_OUTPUT_TOKENS, delayMs: 0 }
      : {
          latencyMs: LATENCY_MS,
          tokens: OUTPUT_TOKENS,
          delayMs: Math.round(1000 / TOKENS_PER_SECOND),
        };
  if (raw.includes(SLOW_MARKER)) plan.latencyMs = SLOW_LATENCY_MS;
  if (raw.includes(LONG_STREAM_MARKER)) {
    plan.tokens = LONG_STREAM_TOKENS;
    plan.delayMs = LONG_STREAM_DELAY_MS;
  }
  return plan;
}

const wait = (ms) => (ms > 0 ? sleep(ms) : Promise.resolve());

async function streamTo(response, protocol, plan, { cutAfter } = {}) {
  await wait(plan.latencyMs);
  if (response.destroyed) return;
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const ctx = { seq: 0 };
  let out = protocol.start(ctx);
  if (plan.delayMs === 0 && cutAfter === undefined) {
    for (let i = 0; i < plan.tokens; i++) out += protocol.delta(ctx, i);
    response.end(out + protocol.end(ctx, plan.tokens));
    return;
  }
  response.write(out);
  for (let i = 0; i < plan.tokens; i++) {
    if (response.destroyed) return;
    if (i === cutAfter) {
      response.destroy();
      return;
    }
    response.write(protocol.delta(ctx, i));
    await wait(plan.delayMs);
  }
  response.end(protocol.end(ctx, plan.tokens));
}

async function jsonTo(response, protocol, plan) {
  await wait(plan.latencyMs + plan.tokens * plan.delayMs);
  if (response.destroyed) return;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(protocol.json(plan.tokens)));
}

const error = (response, status, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify({ error: { message: `upstream said ${status}`, type: 'perf' } }));
};

let flapCalls = 0;
const FAULTS = {
  '5xx': (response) => (error(response, 503), true),
  429: (response) => (error(response, 429, { 'retry-after': '5' }), true),
  timeout: () => true,
  reset: (response) => (response.destroy(), true),
  midstream: (response, { protocol, plan }) => (
    void streamTo(response, protocol, plan, { cutAfter: 5 }),
    true
  ),
  malformed: (response, { wantsStream }) => {
    response.writeHead(200, {
      'content-type': wantsStream ? 'text/event-stream' : 'application/json',
    });
    response.end(wantsStream ? 'data: {not json\n\ndata: [DONE]\n\n' : '{not json');
    return true;
  },
  flap: (response) => (flapCalls++ % 10 < FLAP_FAILS_PER_10 ? (error(response, 503), true) : false),
};

createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200).end('ok');
    return;
  }
  const target = targetOf(request.url ?? '');
  const known = target.mode === 'instant' || target.mode === 'paced' || target.mode === 'fault';
  if (request.method !== 'POST' || !target.protocol || !known) {
    response.writeHead(404).end('not found');
    return;
  }
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let wantsStream = false;
    try {
      wantsStream = JSON.parse(raw).stream === true;
    } catch {}
    const plan = planOf(target.mode === 'instant' ? 'instant' : 'paced', raw);
    const { protocol } = target;
    if (target.mode === 'fault') {
      const fault = FAULTS[target.fault];
      if (!fault) {
        response.writeHead(404).end('unknown fault');
        return;
      }
      if (fault(response, { protocol, plan, wantsStream })) return;
    }
    void (wantsStream ? streamTo(response, protocol, plan) : jsonTo(response, protocol, plan));
  });
}).listen(PORT, () => console.log(`fake upstream on :${PORT}`));
