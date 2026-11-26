import type { ClientProtocol } from '@/db/schemas';

export const DEMO_USER = { email: 'admin@example.com', password: 'routerlm-demo' } as const;

export interface DemoProviderAccount {
  providerSlug: string;
  name: string;
  key: string;
  priority: number;
}

export const DEMO_PROVIDER_ACCOUNTS: DemoProviderAccount[] = [
  { providerSlug: 'anthropic', name: 'Orion', key: 'sk-demo-anthropic-orion-7Qe2', priority: 0 },
  { providerSlug: 'openai', name: 'Lyra', key: 'sk-demo-openai-lyra-4Kd9', priority: 0 },
  { providerSlug: 'openai', name: 'Vega', key: 'sk-demo-openai-vega-8Wm1', priority: 1 },
  { providerSlug: 'moonshot', name: 'Cygnus', key: 'sk-demo-moonshot-cygnus-2Pz6', priority: 0 },
  { providerSlug: 'kimi-code', name: 'Draco', key: 'sk-demo-kimi-code-draco-5Hx3', priority: 0 },
  {
    providerSlug: 'minimax-m-plan',
    name: 'Pegasus',
    key: 'sk-demo-minimax-pegasus-9Ta4',
    priority: 0,
  },
  {
    providerSlug: 'alibaba-model-studio-intl',
    name: 'Aquila',
    key: 'sk-demo-alibaba-aquila-3Lc8',
    priority: 0,
  },
  { providerSlug: 'deepseek', name: 'Hydra', key: 'sk-demo-deepseek-hydra-6Rv5', priority: 0 },
];

export interface TrafficProfile {
  contextTokens: number;
  outputTokens: number;
  cacheReadShare: number;
  reasoningShare: number;
  firstTokenMs: number;
  outputTokensPerSecond: number;
}

export interface DemoRoute {
  providerSlug: string;
  upstreamModelId: string;
}

export const DEMO_MODEL_NAMES = ['smart', 'coder', 'fast', 'reasoning', 'vision'] as const;
export type DemoModelName = (typeof DEMO_MODEL_NAMES)[number];

export interface DemoModel {
  name: DemoModelName;
  routes: DemoRoute[];
  profile: TrafficProfile;
}

export const DEMO_MODELS: DemoModel[] = [
  {
    name: 'smart',
    routes: [
      { providerSlug: 'anthropic', upstreamModelId: 'claude-sonnet-5-5' },
      { providerSlug: 'openai', upstreamModelId: 'gpt-6-sol' },
      { providerSlug: 'moonshot', upstreamModelId: 'kimi-k3.1-pro' },
    ],
    profile: {
      contextTokens: 6_000,
      outputTokens: 550,
      cacheReadShare: 0.35,
      reasoningShare: 0.2,
      firstTokenMs: 900,
      outputTokensPerSecond: 70,
    },
  },
  {
    name: 'coder',
    routes: [
      { providerSlug: 'kimi-code', upstreamModelId: 'kimi-for-coding' },
      { providerSlug: 'minimax-m-plan', upstreamModelId: 'MiniMax-M3' },
      { providerSlug: 'alibaba-model-studio-intl', upstreamModelId: 'qwen3.8-max' },
    ],
    profile: {
      contextTokens: 14_000,
      outputTokens: 800,
      cacheReadShare: 0.45,
      reasoningShare: 0.15,
      firstTokenMs: 1_100,
      outputTokensPerSecond: 85,
    },
  },
  {
    name: 'fast',
    routes: [
      { providerSlug: 'anthropic', upstreamModelId: 'claude-haiku-5-5' },
      { providerSlug: 'openai', upstreamModelId: 'gpt-5.4-mini' },
      { providerSlug: 'deepseek', upstreamModelId: 'deepseek-flash' },
    ],
    profile: {
      contextTokens: 1_800,
      outputTokens: 220,
      cacheReadShare: 0.15,
      reasoningShare: 0,
      firstTokenMs: 350,
      outputTokensPerSecond: 140,
    },
  },
  {
    name: 'reasoning',
    routes: [
      { providerSlug: 'openai', upstreamModelId: 'gpt-6.1-sol' },
      { providerSlug: 'anthropic', upstreamModelId: 'claude-opus-5-5' },
      { providerSlug: 'deepseek', upstreamModelId: 'deepseek-v4-pro' },
    ],
    profile: {
      contextTokens: 5_000,
      outputTokens: 2_400,
      cacheReadShare: 0.2,
      reasoningShare: 0.6,
      firstTokenMs: 2_600,
      outputTokensPerSecond: 55,
    },
  },
  {
    name: 'vision',
    routes: [
      { providerSlug: 'openai', upstreamModelId: 'gpt-6-luna' },
      { providerSlug: 'alibaba-model-studio-intl', upstreamModelId: 'qwen3-vl-plus' },
      { providerSlug: 'anthropic', upstreamModelId: 'claude-sonnet-5-5' },
    ],
    profile: {
      contextTokens: 3_200,
      outputTokens: 350,
      cacheReadShare: 0.1,
      reasoningShare: 0,
      firstTokenMs: 1_300,
      outputTokensPerSecond: 90,
    },
  },
];

export type ModelMix = Partial<Record<DemoModelName, number>>;

export interface DemoCaller {
  apiKeyName: string | null;
  weight: number;
  clientProtocol: ClientProtocol;
  streamedShare: number;
  userAgent: string;
  clientIp: string;
  models: ModelMix;
}

export const DEMO_CALLERS: DemoCaller[] = [
  {
    apiKeyName: 'Claude Code',
    weight: 34,
    clientProtocol: 'anthropic-messages',
    streamedShare: 1,
    userAgent: 'claude-cli/3.4.2 (external, cli)',
    clientIp: '10.20.0.14',
    models: { smart: 5, coder: 3, fast: 2 },
  },
  {
    apiKeyName: 'Cursor',
    weight: 30,
    clientProtocol: 'openai-chat',
    streamedShare: 0.95,
    userAgent: 'Cursor/2.8.1',
    clientIp: '10.20.0.27',
    models: { coder: 5, smart: 3, fast: 2 },
  },
  {
    apiKeyName: 'Internal tools',
    weight: 16,
    clientProtocol: 'openai-responses',
    streamedShare: 0.4,
    userAgent: 'OpenAI/Python 2.31.0',
    clientIp: '10.30.1.5',
    models: { fast: 4, vision: 3, reasoning: 2, smart: 1 },
  },
  {
    apiKeyName: 'CI',
    weight: 12,
    clientProtocol: 'openai-chat',
    streamedShare: 0,
    userAgent: 'OpenAI/JS 7.57.0',
    clientIp: '10.40.2.9',
    models: { coder: 3, fast: 3, reasoning: 1 },
  },
  {
    apiKeyName: null,
    weight: 8,
    clientProtocol: 'openai-chat',
    streamedShare: 1,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15',
    clientIp: '10.20.0.31',
    models: { smart: 3, reasoning: 2, vision: 1, fast: 1, coder: 1 },
  },
];

export interface DemoQuotaMeter {
  providerSlug: string;
  key: string;
  label: string;
  unit: 'percent' | 'count';
  used: number;
  limit: number;
  windowSeconds: number;
  resetsInSeconds: number;
}

const FIVE_HOURS_IN_SECONDS = 5 * 60 * 60;
const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

export const DEMO_QUOTA_METERS: DemoQuotaMeter[] = [
  {
    providerSlug: 'kimi-code',
    key: '5h',
    label: '5-hour limit',
    unit: 'percent',
    used: 38,
    limit: 100,
    windowSeconds: FIVE_HOURS_IN_SECONDS,
    resetsInSeconds: 2 * 60 * 60 + 14 * 60,
  },
  {
    providerSlug: 'kimi-code',
    key: '7d',
    label: '7-day limit',
    unit: 'percent',
    used: 61,
    limit: 100,
    windowSeconds: SEVEN_DAYS_IN_SECONDS,
    resetsInSeconds: 2 * 24 * 60 * 60 + 5 * 60 * 60,
  },
  {
    providerSlug: 'minimax-m-plan',
    key: '5h',
    label: '5-hour window',
    unit: 'count',
    used: 212,
    limit: 600,
    windowSeconds: FIVE_HOURS_IN_SECONDS,
    resetsInSeconds: 3 * 60 * 60 + 40 * 60,
  },
  {
    providerSlug: 'minimax-m-plan',
    key: 'weekly',
    label: 'Weekly window',
    unit: 'count',
    used: 2_450,
    limit: 6_000,
    windowSeconds: SEVEN_DAYS_IN_SECONDS,
    resetsInSeconds: 4 * 24 * 60 * 60 + 9 * 60 * 60,
  },
];
