// CodeBuddy CLI invite chain — one row action that runs web chat → daily probe
// → invite bind, resumable from the failed step. Progress persists on the
// connection row (`data.inviteChain`) so a failed chain can be continued later
// without repeating steps that already passed.
import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { bindInviteForConnection } from "./codebuddyInviteBind";
import { runCodebuddyProbeForConnection } from "./codebuddyProbeScheduler";
import { runWebchatForConnection } from "./codebuddyWebchat";

const CHAIN_KEY = "inviteChain";
const CHAIN_STEPS = ["webchat", "probe", "bind"] as const;
export type InviteChainStep = (typeof CHAIN_STEPS)[number];

export interface InviteChainState {
  step: InviteChainStep | "done";
  status: "failed" | "done";
  error: string | null;
  inviteCode?: string;
  conversationId?: string;
  messageId?: string;
  updatedAt: string;
}

export interface InviteChainStepResult {
  step: InviteChainStep;
  ok: boolean;
  error: string | null;
}

export interface InviteChainResult {
  ok: boolean;
  connectionId: string;
  step: InviteChainStep | "done";
  error?: string;
  steps: InviteChainStepResult[];
}

export function readInviteChainState(connection: ProviderConnection): InviteChainState | null {
  const raw = (connection.data as Record<string, unknown> | undefined)?.[CHAIN_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const state = raw as Partial<InviteChainState>;
  const stepOk = state.step === "webchat" || state.step === "probe" || state.step === "bind" || state.step === "done";
  if (!stepOk) return null;
  return {
    step: state.step as InviteChainStep | "done",
    status: state.status === "done" ? "done" : "failed",
    error: typeof state.error === "string" ? state.error : null,
    inviteCode: typeof state.inviteCode === "string" ? state.inviteCode : undefined,
    conversationId: typeof state.conversationId === "string" ? state.conversationId : undefined,
    messageId: typeof state.messageId === "string" ? state.messageId : undefined,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

function writeChainState(runtime: Runtime, connectionId: string, patch: Partial<InviteChainState>): void {
  const current = runtime.repos.providers.get(connectionId);
  if (!current) return;
  const data = current.data as Record<string, unknown>;
  const existing = data[CHAIN_KEY] && typeof data[CHAIN_KEY] === "object" ? data[CHAIN_KEY] as Record<string, unknown> : {};
  runtime.repos.providers.patch(connectionId, {
    data: { [CHAIN_KEY]: { ...existing, ...patch, updatedAt: new Date().toISOString() } },
  });
}

async function runStep(
  runtime: Runtime,
  connectionId: string,
  step: InviteChainStep,
  inviteCode: string,
): Promise<{ ok: boolean; error: string | null; conversationId?: string; messageId?: string }> {
  if (step === "webchat") {
    const result = await runWebchatForConnection(runtime, connectionId);
    return {
      ok: result.ok,
      error: result.error ?? null,
      conversationId: result.conversationId,
      messageId: result.messageId,
    };
  }
  if (step === "probe") {
    const result = await runCodebuddyProbeForConnection(runtime, connectionId);
    return { ok: result.ok, error: result.error ?? null };
  }
  const result = await bindInviteForConnection(runtime, connectionId, inviteCode);
  return { ok: result.ok, error: result.error ?? null };
}

function normalizeProxyPoolId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "__none__") return null;
  return String(value);
}

export async function runInviteChainForConnection(
  runtime: Runtime,
  connectionId: string,
  inviteCode: string,
  options: { proxyPoolId?: string | null } = {},
): Promise<InviteChainResult> {
  const code = inviteCode.trim();
  let connection = runtime.repos.providers.get(connectionId);
  if (!connection) {
    return { ok: false, connectionId, step: "webchat", error: "Connection not found", steps: [] };
  }
  if (connection.provider !== "codebuddy-intl-cli") {
    return { ok: false, connectionId, step: "webchat", error: "Invite chain is only available for CodeBuddy intl CLI connections", steps: [] };
  }
  if (!code) {
    return { ok: false, connectionId, step: "webchat", error: "Invite code is required", steps: [] };
  }

  if (options.proxyPoolId !== undefined) {
    const poolId = options.proxyPoolId;
    if (poolId !== null && !runtime.repos.proxies.get(poolId)) {
      return { ok: false, connectionId, step: "webchat", error: "Proxy pool not found", steps: [] };
    }
    runtime.repos.providers.patch(connectionId, { data: { proxyPoolId: poolId } });
    connection = runtime.repos.providers.get(connectionId)!;
  }

  const existing = readInviteChainState(connection);
  if (existing && existing.status === "done") {
    return { ok: true, connectionId, step: "done", steps: [] };
  }

  let startStep: InviteChainStep = "webchat";
  if (existing && existing.status === "failed" && (CHAIN_STEPS as readonly string[]).includes(existing.step)) {
    startStep = existing.step as InviteChainStep;
  }
  const startIndex = CHAIN_STEPS.indexOf(startStep);
  const trail: InviteChainStepResult[] = [];

  for (let i = startIndex; i < CHAIN_STEPS.length; i++) {
    const step = CHAIN_STEPS[i];
    writeChainState(runtime, connectionId, { step, status: "failed", error: null, inviteCode: code });
    const outcome = await runStep(runtime, connectionId, step, code);
    trail.push({ step, ok: outcome.ok, error: outcome.error });
    if (!outcome.ok) {
      writeChainState(runtime, connectionId, { step, status: "failed", error: outcome.error, inviteCode: code });
      return { ok: false, connectionId, step, error: outcome.error ?? "Step failed", steps: trail };
    }
    if (step === "webchat") {
      writeChainState(runtime, connectionId, {
        step,
        status: "failed",
        error: null,
        inviteCode: code,
        conversationId: outcome.conversationId,
        messageId: outcome.messageId,
      });
    }
  }

  writeChainState(runtime, connectionId, { step: "done", status: "done", error: null, inviteCode: code });
  return { ok: true, connectionId, step: "done", steps: trail };
}

export async function runInviteChainForConnections(
  runtime: Runtime,
  connectionIds: string[],
  inviteCode: string,
  options: { proxyPoolId?: string | null } = {},
): Promise<{ success: number; failed: number; results: InviteChainResult[] }> {
  const results: InviteChainResult[] = [];
  for (const id of connectionIds) {
    results.push(await runInviteChainForConnection(runtime, id, inviteCode, options));
  }
  return {
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

export { normalizeProxyPoolId };
