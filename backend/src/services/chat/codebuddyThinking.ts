// CodeBuddy reasoning parity with the CodeBuddy Code CLI.
//
// The CLI injects `reasoning_summary: "auto"` on the outgoing OpenAI wire
// body (its `injectReasoningSummaryIfNeeded` step) whenever thinking is
// active. Thinking defaults ON there (`alwaysThinkingEnabled: true`), so a
// plain CLI request still carries the flag and the upstream gateway answers
// with `delta.reasoning_content` SSE chunks (surfaced as thinking events).
//
// LobakAI previously only mirrored `reasoning_summary` when the client had
// already sent `reasoning_effort`, so plain requests never triggered the
// upstream reasoning path. This helper restores CLI parity at the product
// layer (executors stay generic): set `reasoning_summary: "auto"`
// unless the caller explicitly opted out.
const CODEBUDDY_PROVIDERS = new Set(["codebuddy-cn", "codebuddy-intl-cli", "codebuddy"]);

// Explicit thinking opt-outs. The executors delete these effort
// values ("gateway has no none, just omit"), so never inject under them.
const DISABLED_EFFORTS = new Set(["none", "off"]);

export function isCodebuddyProviderId(provider: string): boolean {
  return CODEBUDDY_PROVIDERS.has(provider);
}

function hasDisabledEffort(body: Record<string, unknown>): boolean {
  const effort = body.reasoning_effort;
  if (typeof effort === "string" && DISABLED_EFFORTS.has(effort)) return true;
  const nested = body.reasoning;
  if (nested && typeof nested === "object") {
    const nestedEffort = (nested as Record<string, unknown>).effort;
    if (typeof nestedEffort === "string" && DISABLED_EFFORTS.has(nestedEffort)) return true;
  }
  return false;
}

// Mirror the CLI wire default for CodeBuddy providers. Keeps an explicitly
// set `reasoning_summary` and respects the `off` thinking override.
export function applyCodebuddyReasoningSummary(
  body: Record<string, unknown>,
  provider: string,
  providerThinking: { mode?: string } | null,
): Record<string, unknown> {
  if (!isCodebuddyProviderId(provider)) return body;
  if (providerThinking?.mode === "off") return body;
  if (body.reasoning_summary) return body;
  if (hasDisabledEffort(body)) return body;
  return { ...body, reasoning_summary: "auto" };
}
