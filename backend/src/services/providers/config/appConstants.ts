import { platform, arch } from "os";
import { PROVIDERS, PROVIDER_OAUTH } from "./providers.ts";
import {
  ANTIGRAVITY_IDE_USER_AGENT,
  ANTIGRAVITY_IDE_BASE_URL,
  ANTIGRAVITY_SANDBOX_ENDPOINT,
  getAntigravityModelWireProfile,
} from "../registryShared.ts";

// === Antigravity enums ===
export const IDE_TYPE = {
  UNSPECIFIED: 0,
  JETSKI: 10,
  ANTIGRAVITY: 9,
  PLUGINS: 7
};

export const PLATFORM = {
  UNSPECIFIED: 0,
  DARWIN_AMD64: 1,
  DARWIN_ARM64: 2,
  LINUX_AMD64: 3,
  LINUX_ARM64: 4,
  WINDOWS_AMD64: 5
};

export const PLUGIN_TYPE = {
  UNSPECIFIED: 0,
  CLOUD_CODE: 1,
  GEMINI: 2
};

export function getPlatformEnum() {
  const os = platform();
  const architecture = arch();
  if (os === "darwin") return architecture === "arm64" ? PLATFORM.DARWIN_ARM64 : PLATFORM.DARWIN_AMD64;
  if (os === "linux") return architecture === "arm64" ? PLATFORM.LINUX_ARM64 : PLATFORM.LINUX_AMD64;
  if (os === "win32") return PLATFORM.WINDOWS_AMD64;
  return PLATFORM.UNSPECIFIED;
}

export function getPlatformUserAgent() {
  return ANTIGRAVITY_IDE_USER_AGENT;
}

export const CLIENT_METADATA = {
  ideType: IDE_TYPE.ANTIGRAVITY,
  platform: getPlatformEnum(),
  pluginType: PLUGIN_TYPE.GEMINI
};

// Internal anti-loop header
export const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };

// Suffix added to client tools when forwarding to Antigravity provider (anti-ban cloaking)
export const AG_TOOL_SUFFIX = "_ide";

// Suffix added to client tools when forwarding to Claude provider (anti-ban cloaking)
export const CLAUDE_TOOL_SUFFIX = "_ide";

// CC native default tools — these are Claude Code's own tools, kept as decoys
// Client tools matching these names are skipped (not renamed), others get _cc suffix
export const CC_DEFAULT_TOOLS = new Set([
  "Task",
  "TaskOutput",
  "TaskStop",
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "Skill",
  "EnterPlanMode",
  "ExitPlanMode",
]);

// AG native default tools — kept as decoys with neutral description/properties
// These names must match exactly what AG sends in the real request log
export const AG_DEFAULT_TOOLS = new Set([
  "browser_subagent",
  "command_status",
  "find_by_name",
  "generate_image",
  "grep_search",
  "list_dir",
  "list_resources",
  "multi_replace_file_content",
  "notify_user",
  "read_resource",
  "read_terminal",
  "read_url_content",
  "replace_file_content",
  "run_command",
  "search_web",
  "send_command_input",
  "task_boundary",
  "view_content_chunk",
  "view_file",
  "write_to_file"
]);

// Antigravity chat/stream headers (official IDE Desktop fingerprint)
export const ANTIGRAVITY_HEADERS = {
  "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
  "Client-Metadata": "ideType=ANTIGRAVITY,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
};

// Antigravity endpoint constants (oh-my-pi approach)
export const ANTIGRAVITY_PRIMARY_ENDPOINT = ANTIGRAVITY_IDE_BASE_URL;
export const ANTIGRAVITY_SANDBOX_ENDPOINT_URL = ANTIGRAVITY_SANDBOX_ENDPOINT;
export const ANTIGRAVITY_ENDPOINT_FALLBACKS = [ANTIGRAVITY_PRIMARY_ENDPOINT, ANTIGRAVITY_SANDBOX_ENDPOINT_URL] as const;

// Cloud Code Assist API endpoints differ by client ecosystem.
// Project discovery (loadCodeAssist/onboardUser) stays on PROD — the daily host
// rejects these auth/onboarding calls. Only chat traffic uses the daily host.
export const CLOUD_CODE_API = {
  antigravity: {
    loadCodeAssist: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    onboardUser: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
  },
};

export const LOAD_CODE_ASSIST_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": JSON.stringify({ ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" }),
};

export const LOAD_CODE_ASSIST_METADATA = {
  ideType: "ANTIGRAVITY",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
};

// System prompts
export const CLAUDE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";
export const ANTIGRAVITY_DEFAULT_SYSTEM = "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**";

// Derive từ registry oauth.refreshLeadMs
export const REFRESH_LEAD_MS = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH as Record<string, any>).filter(([, o]) => o.refreshLeadMs).map(([id, o]) => [id, o.refreshLeadMs])
);

// OAuth endpoints
export const OAUTH_ENDPOINTS = {
  google:    { token: "https://oauth2.googleapis.com/token", auth: "https://accounts.google.com/o/oauth2/auth" },
  openai:    { token: PROVIDER_OAUTH["codex"]?.tokenUrl, auth: PROVIDER_OAUTH["codex"]?.authorizeUrl },
  anthropic: { token: PROVIDER_OAUTH["claude"]?.tokenUrl, auth: "https://api.anthropic.com/v1/oauth/authorize" }, // ≠ claude.authorizeUrl (claude.ai login) — keep
};
