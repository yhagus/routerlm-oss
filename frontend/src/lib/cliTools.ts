export type CliToolKind =
  "env" | "toml" | "json" | "desktop" | "guide" | "mitm";

export interface CliTool {
  id: string;
  name: string;
  description: string;
  kind: CliToolKind;
  image?: string;
  color?: string;
  configPath?: string;
  docsUrl?: string;
  aliases?: string[];
  mitmDomain?: string;
}

// Field values and order mirror v1 shared/constants/cliTools.js.
export const CLI_TOOLS: Record<string, CliTool> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic Claude Code CLI",
    kind: "env",
    image: "/providers/claude.png",
    color: "#D97757",
    configPath: "~/.claude/settings.json",
    aliases: ["sonnet", "opus", "haiku", "fable", "opusplan"],
  },
  openclaw: {
    id: "openclaw",
    name: "Open Claw",
    description: "Open Claw AI Assistant",
    kind: "guide",
    image: "/providers/openclaw.png",
    color: "#FF6B35",
    docsUrl: "https://github.com/openclaw",
  },
  codex: {
    id: "codex",
    name: "OpenAI Codex CLI / App",
    description: "OpenAI Codex CLI",
    kind: "toml",
    image: "/providers/codex.png",
    color: "#10A37F",
    configPath: "~/.codex/config.toml",
    docsUrl: "https://github.com/openai/codex",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    description: "OpenCode AI Terminal Assistant",
    kind: "json",
    image: "/providers/opencode.png",
    color: "#E87040",
    configPath: "~/.config/opencode/opencode.json",
    docsUrl: "https://opencode.ai",
  },
  cowork: {
    id: "cowork",
    name: "Claude Cowork",
    description: "Claude Desktop Cowork (third-party inference)",
    kind: "desktop",
    image: "/providers/claude.png",
    color: "#D97757",
    docsUrl: "https://support.claude.com",
  },
  hermes: {
    id: "hermes",
    name: "Hermes Agent",
    description: "Nous Research self-improving AI agent",
    kind: "guide",
    image: "/providers/hermes.png",
    color: "#8B5CF6",
    docsUrl: "https://github.com/NousResearch/hermes-agent",
  },
  droid: {
    id: "droid",
    name: "Factory Droid",
    description: "Factory Droid AI Assistant",
    kind: "guide",
    image: "/providers/droid.png",
    color: "#00D4FF",
    docsUrl: "https://factory.ai",
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    description: "Cursor AI Code Editor",
    kind: "guide",
    image: "/providers/cursor.png",
    color: "#000000",
    docsUrl: "https://cursor.com",
  },
  cline: {
    id: "cline",
    name: "Cline",
    description: "Cline AI Coding Assistant",
    kind: "guide",
    image: "/providers/cline.png",
    color: "#00D1B2",
    docsUrl: "https://docs.cline.bot",
  },
  kilo: {
    id: "kilo",
    name: "Kilo Code",
    description: "Kilo Code AI Assistant",
    kind: "guide",
    image: "/providers/kilocode.png",
    color: "#FF6B6B",
    docsUrl: "https://kilocode.ai",
  },
  roo: {
    id: "roo",
    name: "Roo",
    description: "Roo AI Assistant",
    kind: "guide",
    image: "/providers/roo.png",
    color: "#FF6B6B",
    docsUrl: "https://roocode.com",
  },
  continue: {
    id: "continue",
    name: "Continue",
    description: "Continue AI Assistant",
    kind: "guide",
    image: "/providers/continue.png",
    color: "#7C3AED",
    docsUrl: "https://continue.dev",
  },
  amp: {
    id: "amp",
    name: "Amp CLI",
    description: "Sourcegraph Amp coding assistant CLI",
    kind: "guide",
    image: "/providers/amp.png",
    color: "#F97316",
    docsUrl: "https://ampcode.com",
  },
  qwen: {
    id: "qwen",
    name: "Qwen Code",
    description:
      "Alibaba Qwen Code CLI — supports OpenAI, Anthropic & Gemini providers via LobakAI",
    kind: "guide",
    image: "/providers/qwen.png",
    color: "#10B981",
    docsUrl:
      "https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/",
  },
  "deepseek-tui": {
    id: "deepseek-tui",
    name: "DeepSeek TUI",
    description: "DeepSeek Terminal Coding Agent (Rust TUI)",
    kind: "toml",
    image: "/providers/deepseek-tui.png",
    color: "#4D6BFE",
    configPath: "~/.deepseek/config.toml",
    docsUrl: "https://github.com/DeepSeek-TUI/DeepSeek-TUI",
  },
  jcode: {
    id: "jcode",
    name: "jcode",
    description: "High-performance Rust-based coding agent harness",
    kind: "guide",
    image: "/providers/jcode.png",
    color: "#FF6B35",
    docsUrl: "https://github.com/1jehuang/jcode",
  },
  "grok-build": {
    id: "grok-build",
    name: "Grok Build",
    description: "xAI Grok Build TUI coding agent",
    kind: "toml",
    image: "/providers/grok-cli.png",
    color: "#1DA1F2",
    configPath: "~/.grok/config.toml",
    docsUrl: "https://x.ai/cli",
  },
};

export const MITM_TOOLS: Record<string, CliTool> = {
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    description: "Google Antigravity IDE with MITM",
    kind: "mitm",
    image: "/providers/antigravity.png",
    color: "#4285F4",
    mitmDomain: "daily-cloudcode-pa.googleapis.com",
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot",
    description: "GitHub Copilot IDE with MITM",
    kind: "mitm",
    image: "/providers/copilot.png",
    color: "#1F6FEB",
    mitmDomain: "api.individual.githubcopilot.com",
  },
  kiro: {
    id: "kiro",
    name: "Kiro",
    description: "Kiro IDE with MITM",
    kind: "mitm",
    image: "/providers/kiro.png",
    color: "#FF6B00",
    mitmDomain: "q.us-east-1.amazonaws.com",
  },
};

export function getCliTool(id: string | undefined) {
  return id ? { ...CLI_TOOLS, ...MITM_TOOLS }[id] || null : null;
}

export function toolKindLabel(kind: CliToolKind) {
  const labels: Record<CliToolKind, string> = {
    env: "Environment variables",
    toml: "TOML configuration",
    json: "JSON configuration",
    desktop: "Desktop configuration",
    guide: "Manual guide",
    mitm: "MITM route",
  };
  return labels[kind];
}
