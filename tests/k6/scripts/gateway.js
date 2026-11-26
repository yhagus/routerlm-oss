import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://backend:3000';
const API_KEY = __ENV.PERF_API_KEY;
const PROFILE = __ENV.PROFILE || 'smoke';
const SCENARIO = __ENV.SCENARIO || 'mixed';
const PACED_ANSWER_MS =
  Number(__ENV.UPSTREAM_LATENCY_MS || 200) +
  (Number(__ENV.OUTPUT_TOKENS || 200) / Number(__ENV.TOKENS_PER_SECOND || 100)) * 1000;

const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${API_KEY}`,
};
const USER_MESSAGE = [{ role: 'user', content: 'Say hello.' }];

const CHARACTERS_PER_TOKEN = 4;
const textOfTokens = (tokens) => 'word '.repeat((tokens * CHARACTERS_PER_TOKEN) / 5);

const chatBody = (model, extra = {}) => ({ model, messages: USER_MESSAGE, ...extra });
const STREAM = { stream: true, stream_options: { include_usage: true } };

const OK = { min: 200, max: 200 };
const ERROR = { min: 400, max: 599 };
const SCENARIOS = {
  chat: {
    group: 'mixed',
    weight: 40,
    path: '/v1/chat/completions',
    body: () => chatBody('perf-chat'),
    expect: OK,
    done: 'chat.completion',
  },
  'chat-stream': {
    group: 'mixed',
    weight: 30,
    path: '/v1/chat/completions',
    body: () => chatBody('perf-chat', STREAM),
    expect: OK,
    done: '[DONE]',
  },
  messages: {
    group: 'mixed',
    weight: 15,
    path: '/v1/messages',
    body: () => ({ model: 'perf-messages', max_tokens: 256, messages: USER_MESSAGE }),
    expect: OK,
    done: 'end_turn',
  },
  responses: {
    group: 'mixed',
    weight: 15,
    path: '/v1/responses',
    body: () => ({ model: 'perf-responses', input: 'Say hello.' }),
    expect: OK,
    done: 'completed',
  },

  'raw-chat': {
    group: 'raw',
    weight: 40,
    path: '/v1/chat/completions',
    body: () => chatBody('raw-chat'),
    expect: OK,
    done: 'chat.completion',
  },
  'raw-chat-stream': {
    group: 'raw',
    weight: 30,
    path: '/v1/chat/completions',
    body: () => chatBody('raw-chat', STREAM),
    expect: OK,
    done: '[DONE]',
  },
  'raw-messages': {
    group: 'raw',
    weight: 15,
    path: '/v1/messages',
    body: () => ({ model: 'raw-messages', max_tokens: 256, messages: USER_MESSAGE }),
    expect: OK,
    done: 'end_turn',
  },
  'raw-responses': {
    group: 'raw',
    weight: 15,
    path: '/v1/responses',
    body: () => ({ model: 'raw-responses', input: 'Say hello.' }),
    expect: OK,
    done: 'completed',
  },

  'huge-context': {
    group: 'edge',
    vus: 4,
    p95Ms: PACED_ANSWER_MS + 5000,
    path: '/v1/chat/completions',
    body: () => ({
      model: 'perf-large',
      messages: [{ role: 'user', content: textOfTokens(900_000) }],
    }),
    expect: OK,
    done: 'chat.completion',
  },
  'huge-context-stream': {
    group: 'edge',
    vus: 4,
    p95Ms: PACED_ANSWER_MS + 5000,
    path: '/v1/chat/completions',
    body: () => ({
      model: 'perf-large',
      ...STREAM,
      messages: [{ role: 'user', content: textOfTokens(900_000) }],
    }),
    expect: OK,
    done: '[DONE]',
  },
  'over-context': {
    group: 'edge',
    vus: 4,
    p95Ms: 5000,
    path: '/v1/chat/completions',
    body: () => ({
      model: 'perf-chat',
      messages: [{ role: 'user', content: textOfTokens(1_200_000) }],
    }),
    expect: { min: 400, max: 499 },
    pauseS: 0.5,
  },
  'oversize-body': {
    group: 'edge',
    vus: 2,
    p95Ms: 10000,
    path: '/v1/chat/completions',
    body: () => ({
      model: 'perf-large',
      messages: [{ role: 'user', content: 'x'.repeat(21 * 1024 * 1024) }],
    }),
    expect: { min: 413, max: 413 },
    pauseS: 1,
  },
  'long-conversation': {
    group: 'edge',
    vus: 10,
    p95Ms: PACED_ANSWER_MS + 5000,
    path: '/v1/chat/completions',
    body: () => {
      const messages = [];
      for (let i = 0; i < 2000; i++) {
        messages.push({ role: 'user', content: `Question ${i}?` });
        messages.push({ role: 'assistant', content: `Answer ${i}.` });
      }
      messages.push({ role: 'user', content: 'Say hello.' });
      return { model: 'perf-chat', messages };
    },
    expect: OK,
    done: 'chat.completion',
  },
  'long-stream': {
    group: 'edge',
    vus: 20,
    p95Ms: 30000,
    path: '/v1/chat/completions',
    body: () => ({
      model: 'perf-chat',
      ...STREAM,
      messages: [{ role: 'user', content: '[perf:long-stream]' }],
    }),
    expect: OK,
    done: '[DONE]',
  },
  'slow-upstream': {
    group: 'edge',
    vus: 50,
    p95Ms: 20000,
    path: '/v1/chat/completions',
    body: () => chatBody('perf-chat', { messages: [{ role: 'user', content: '[perf:slow]' }] }),
    expect: OK,
    done: 'chat.completion',
  },

  'fault-5xx': faultCase('5xx', { pauseS: 0.5 }),
  'fault-429': faultCase('429', { pauseS: 0.5 }),
  'fault-timeout': faultCase('timeout', { pauseS: 0.5 }),
  'fault-reset': faultCase('reset', { pauseS: 0.5 }),
  'fault-malformed': faultCase('malformed', { pauseS: 0.5 }),
  'fault-flap': faultCase('flap', { expect: { min: 200, max: 599 }, pauseS: 0.5 }),
  'fault-midstream': faultCase('midstream', {
    stream: true,
    expect: { min: 200, max: 599 },
    pauseS: 0.5,
  }),
  'failover-5xx': failoverCase('5xx'),
  'failover-429': failoverCase('429'),
  'failover-timeout': failoverCase('timeout'),
  'failover-reset': failoverCase('reset'),
  'failover-flap': failoverCase('flap'),
};

function faultCase(kind, { stream = false, expect = ERROR, pauseS } = {}) {
  return {
    group: 'upstream',
    vus: 5,
    p95Ms: 8000,
    path: '/v1/chat/completions',
    body: () => chatBody(`fault-${kind}`, stream ? STREAM : {}),
    expect,
    pauseS,
  };
}

function failoverCase(kind) {
  return {
    group: 'upstream',
    vus: 5,
    p95Ms: PACED_ANSWER_MS + 8000,
    path: '/v1/chat/completions',
    body: () => chatBody(`failover-${kind}`),
    expect: OK,
    done: 'chat.completion',
  };
}

const STEADY_VUS = Number(__ENV.VUS || 300);
const STEADY_DURATION = __ENV.DURATION || '3m';

const BENCH_RAW_VUS = Number(__ENV.BENCH_RAW_VUS || 300);
const BENCH_MIXED_VUS = Number(__ENV.BENCH_MIXED_VUS || 1800);

const PROFILES = {
  bench: {
    stages: [
      ['10s', BENCH_MIXED_VUS],
      ['50s', BENCH_MIXED_VUS],
    ],
    rawClosedStages: [
      ['10s', BENCH_RAW_VUS],
      ['50s', BENCH_RAW_VUS],
    ],
    rawP95Ms: 60000,
    edgeScale: 1,
    edgeDuration: '1m',
    p95Factor: 100,
    maxFailed: 0.01,
  },
  steady: {
    stages: [
      ['30s', STEADY_VUS],
      [STEADY_DURATION, STEADY_VUS],
      ['10s', 0],
    ],
    edgeScale: 1,
    edgeDuration: STEADY_DURATION,
    p95Factor: 2,
    maxFailed: 0,
  },
  smoke: {
    startVUs: 1,
    stages: [['30s', 1]],
    rawStart: 10,
    rawStages: [['30s', 10]],
    rawMaxVUs: 50,
    rawP95Ms: 300,
    edgeScale: 0,
    edgeDuration: '30s',
    p95Factor: 2,
    maxFailed: 0,
  },
  load: {
    stages: [
      ['1m', 300],
      ['3m', 300],
      ['30s', 0],
    ],
    rawStages: [
      ['30s', 500],
      ['3m', 500],
      ['30s', 0],
    ],
    rawMaxVUs: 1000,
    rawP95Ms: 500,
    edgeScale: 1,
    edgeDuration: '3m',
    p95Factor: 2,
    maxFailed: 0.01,
  },
  stress: {
    stages: [
      ['1m', 300],
      ['1m', 600],
      ['1m', 1200],
      ['1m', 2000],
      ['1m', 3000],
      ['30s', 0],
    ],
    rawStages: [
      ['1m', 500],
      ['1m', 1000],
      ['1m', 2000],
      ['1m', 4000],
      ['1m', 8000],
      ['30s', 0],
    ],
    rawMaxVUs: 8000,
    rawP95Ms: 5000,
    edgeScale: 3,
    edgeDuration: '5m',
    p95Factor: 10,
    maxFailed: 0.1,
  },
};

const profile = PROFILES[PROFILE];
if (!profile) {
  throw new Error(`Unknown PROFILE "${PROFILE}"; use smoke, load, stress, steady or bench`);
}
const inGroup = (...groups) =>
  Object.keys(SCENARIOS).filter((name) => groups.includes(SCENARIOS[name].group));
const GROUPS = {
  mixed: inGroup('mixed'),
  raw: inGroup('raw'),
  edge: inGroup('edge'),
  upstream: inGroup('upstream'),
  all: inGroup('mixed', 'edge', 'upstream'),
};
const names = GROUPS[SCENARIO] ?? [SCENARIO];
for (const name of names) {
  if (!SCENARIOS[name]) {
    throw new Error(
      `Unknown SCENARIO "${SCENARIO}"; use ${Object.keys(GROUPS).join(', ')} or one of ${Object.keys(SCENARIOS).join(', ')}`,
    );
  }
}
const weightOf = (group) =>
  names
    .filter((n) => SCENARIOS[n].group === group)
    .reduce((sum, n) => sum + SCENARIOS[n].weight, 0);
const scaled = (target, share) => (target === 0 ? 0 : Math.max(1, Math.round(target * share)));

const scenarios = {};
const thresholds = {
  http_req_failed: [`rate<=${profile.maxFailed}`],
  checks: [`rate>=${1 - profile.maxFailed}`],
};
for (const name of names) {
  const spec = SCENARIOS[name];
  const base = { exec: 'call', env: { SCENARIO_NAME: name } };
  const duration = `p(95)<${spec.p95Ms * profile.p95Factor}`;
  if (spec.group === 'mixed') {
    const share = spec.weight / weightOf('mixed');
    scenarios[name] = {
      ...base,
      executor: 'ramping-vus',
      startVUs: profile.startVUs ?? 0,
      gracefulRampDown: '10s',
      stages: profile.stages.map(([d, target]) => ({ duration: d, target: scaled(target, share) })),
    };
    thresholds[`http_req_duration{scenario:${name}}`] = [
      `p(95)<${(PACED_ANSWER_MS + 500) * profile.p95Factor}`,
    ];
  } else if (spec.group === 'raw') {
    const share = spec.weight / weightOf('raw');
    scenarios[name] = profile.rawClosedStages
      ? {
          ...base,
          executor: 'ramping-vus',
          startVUs: 0,
          gracefulRampDown: '10s',
          stages: profile.rawClosedStages.map(([d, target]) => ({
            duration: d,
            target: scaled(target, share),
          })),
        }
      : {
          ...base,
          executor: 'ramping-arrival-rate',
          startRate: scaled(profile.rawStart ?? 0, share),
          timeUnit: '1s',
          preAllocatedVUs: Math.ceil(profile.rawMaxVUs * share * 0.1),
          maxVUs: Math.ceil(profile.rawMaxVUs * share),
          stages: profile.rawStages.map(([d, target]) => ({
            duration: d,
            target: scaled(target, share),
          })),
        };
    thresholds[`http_req_duration{scenario:${name}}`] = [`p(95)<${profile.rawP95Ms}`];
  } else {
    scenarios[name] = {
      ...base,
      executor: 'constant-vus',
      vus: Math.max(1, spec.vus * profile.edgeScale),
      duration: profile.edgeDuration,
      gracefulStop: '60s',
    };
    thresholds[`http_req_duration{scenario:${name}}`] = [duration];
  }
}

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ['count', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  if (!API_KEY) {
    throw new Error('PERF_API_KEY is not set');
  }
}

const STATUSES = [0, 200, 400, 401, 404, 413, 429, 500, 502, 503, 504];
const byStatus = Object.fromEntries(STATUSES.map((s) => [s, new Counter(`status_${s}`)]));
const otherStatus = new Counter('status_other');

let payload;
let sampled = 0;

export function call() {
  const spec = SCENARIOS[__ENV.SCENARIO_NAME];
  payload ??= JSON.stringify(spec.body());
  const response = http.post(`${BASE_URL}${spec.path}`, payload, {
    headers: HEADERS,
    timeout: '120s',
    responseCallback: http.expectedStatuses(spec.expect),
  });
  (byStatus[response.status] ?? otherStatus).add(1);
  if (
    !(response.status >= spec.expect.min && response.status <= spec.expect.max) &&
    sampled < 2 &&
    __VU % 250 === 0
  ) {
    sampled++;
    console.error(
      `${__ENV.SCENARIO_NAME} -> ${response.status} ${response.error ?? ''} ${String(response.body).slice(0, 200)}`,
    );
  }
  check(response, {
    'expected status': (r) => r.status >= spec.expect.min && r.status <= spec.expect.max,
    'answer is complete': (r) =>
      !spec.done || (typeof r.body === 'string' && r.body.includes(spec.done)),
  });
  if (spec.pauseS) {
    sleep(spec.pauseS);
  }
}
