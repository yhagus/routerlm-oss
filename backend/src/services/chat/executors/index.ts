import { AntigravityExecutor } from "./antigravity.js";
import { QoderExecutor } from "./qoder.js";
import { CodexExecutor } from "./codex.js";
import { OpenCodeExecutor } from "./opencode.js";
import { OpenCodeGoExecutor } from "./opencode-go.js";
import { GrokWebExecutor } from "./grok-web.js";
import { GrokCliExecutor } from "./grok-cli.js";
import { GrokVideoExecutor } from "./grok-video.js";
import { PerplexityWebExecutor } from "./perplexity-web.js";
import { CommandCodeExecutor } from "./commandcode.js";
import { CodeBuddyIntlCliExecutor } from "./codebuddy-intl-cli.js";
import { DefaultExecutor } from "./default.js";

const executors = {
  antigravity: new AntigravityExecutor(),
  qoder: new QoderExecutor(),
  codex: new CodexExecutor(),
  opencode: new OpenCodeExecutor(),
  "opencode-go": new OpenCodeGoExecutor(),
  "grok-web": new GrokWebExecutor(),
  "grok-cli": new GrokCliExecutor(),
  gcli: new GrokCliExecutor(), // Alias
  gb: new GrokCliExecutor(), // Alias (Grok Build)
  "grok-video": new GrokVideoExecutor(),
  "perplexity-web": new PerplexityWebExecutor(),
  commandcode: new CommandCodeExecutor(),
  "codebuddy-intl-cli": new CodeBuddyIntlCliExecutor(),
};

const defaultCache = new Map();

export function getExecutor(provider: any) {
  if ((executors as Record<string, any>)[provider]) return (executors as Record<string, any>)[provider];
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider: any) {
  return !!(executors as Record<string, any>)[provider];
}

export { BaseExecutor } from "./base.js";
export { AntigravityExecutor } from "./antigravity.js";
export { QoderExecutor } from "./qoder.js";
export { CodexExecutor } from "./codex.js";
export { DefaultExecutor } from "./default.js";
export { OpenCodeExecutor } from "./opencode.js";
export { OpenCodeGoExecutor } from "./opencode-go.js";
export { GrokWebExecutor } from "./grok-web.js";
export { GrokCliExecutor } from "./grok-cli.js";
export { PerplexityWebExecutor } from "./perplexity-web.js";
export { CommandCodeExecutor } from "./commandcode.js";
export { CodeBuddyIntlCliExecutor } from "./codebuddy-intl-cli.js";
