// The v1 specialized executors are imported individually (not through
// executors/index.js). Every module here is pure fetch + registry code and
// loads standalone under Bun; qoder's src/ context-window dependency is
// satisfied through the injected resolver below.
import { CodexExecutor } from "./executors/codex.js";
import { AntigravityExecutor } from "./executors/antigravity.js";
import { GrokCliExecutor } from "./executors/grok-cli.js";
import { CodeBuddyIntlCliExecutor } from "./executors/codebuddy-intl-cli.js";
import CodeBuddyExecutor from "./executors/codebuddy-cn.js";
import { OpenCodeExecutor } from "./executors/opencode.js";
import { GrokWebExecutor } from "./executors/grok-web.js";
import { PerplexityWebExecutor } from "./executors/perplexity-web.js";
import { CommandCodeExecutor } from "./executors/commandcode.js";
import { OpenCodeGoExecutor } from "./executors/opencode-go.js";
import { GrokVideoExecutor } from "./executors/grok-video.js";
import { QoderExecutor, setQoderModelContextWindowResolver } from "./executors/qoder.js";
import { DefaultExecutor } from "./executors/default.js";
import { activeExecutionRuntime } from "./executionRuntime";
import { AutoclawExecutor } from "./autoclawExecutor";
import { refreshTokenByProvider } from "../providers/oauth/tokenRefresh.ts";

export interface V1Executor {
  provider: string;
  noAuth?: boolean;
  execute: any;
  refreshCredentials?: any;
  needsRefresh?: any;
  parseError?: any;
  buildUrl?: any;
  buildHeaders?: any;
  transformRequest?: any;
}

const registry = new Map<string, V1Executor>();
const defaultExecutors = new Map<string, V1Executor>();
function register(executor: V1Executor, ...ids: string[]) {
  for (const id of ids) registry.set(id, executor);
}

const codex = new CodexExecutor();
const antigravity = new AntigravityExecutor();
const grokCli = new GrokCliExecutor();
const codebuddyIntlCli = new CodeBuddyIntlCliExecutor();
const codebuddyCn = new CodeBuddyExecutor();
const opencode = new OpenCodeExecutor();
const grokWeb = new GrokWebExecutor();
const perplexityWeb = new PerplexityWebExecutor();
const commandCode = new CommandCodeExecutor();
const opencodeGo = new OpenCodeGoExecutor();
const grokVideo = new GrokVideoExecutor();
const qoder = new QoderExecutor();
const autoclaw = new AutoclawExecutor();

// v1 getModelContextWindow semantics against the v2 kv store: the override is
// a positive integer (floored, capped at 2M) or null when unset/invalid.
setQoderModelContextWindowResolver((provider: string, model: string): number | null => {
  const runtime = activeExecutionRuntime();
  if (!runtime || !provider || !model) return null;
  const row = runtime.sqlite.query("SELECT value FROM kv WHERE scope = 'modelContextWindows' AND key = ?").get(`${provider}/${model}`) as { value: string } | undefined;
  if (!row) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(row.value); } catch { return null; }
  const window = typeof parsed === "number" ? parsed : Number(parsed);
  if (!Number.isFinite(window) || window <= 0) return null;
  return Math.min(Math.floor(window), 2_000_000);
});

register(codex, "codex");
register(antigravity, "antigravity");
register(grokCli, "grok-cli", "gcli", "gb");
register(codebuddyIntlCli, "codebuddy-intl-cli");
register(codebuddyCn, "codebuddy-cn", "codebuddy");
register(opencode, "opencode");
register(grokWeb, "grok-web");
register(perplexityWeb, "perplexity-web");
register(commandCode, "commandcode");
register(opencodeGo, "opencode-go");
register(grokVideo, "grok-video");
register(qoder, "qoder");
register(autoclaw as unknown as V1Executor, "autoclaw");

// Providers that duplicate a dedicated v2 implementation.
const GATED_EXECUTORS: Record<string, string> = {};

export function getV2Executor(provider: string): V1Executor | null {
  const specialized = registry.get(provider);
  if (specialized) return specialized;
  if (GATED_EXECUTORS[provider]) return null;

  let executor = defaultExecutors.get(provider);
  if (!executor) {
    executor = new DefaultExecutor(provider) as V1Executor;
    executor.refreshCredentials = (credentials: any, log: any) => refreshTokenByProvider(provider, credentials, log);
    defaultExecutors.set(provider, executor);
  }
  return executor;
}

export function executorGateReason(provider: string): string | null {
  return GATED_EXECUTORS[provider] || null;
}

export function specializedExecutorProviders(): string[] {
  return [...registry.keys()];
}
