/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { getAntigravityUsage } from "./usage/google.js";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage, consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "./usage/codex.js";

export { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits };
import { getCodeBuddyIntlCliUsage } from "./usage/codebuddy.js";
import { getGrokCliUsage } from "./usage/grok-cli.js";
import { getDeepseekUsage } from "./usage/deepseek.js";
import { getDeepseekHarnessUsage } from "./usage/deepseek-harness.js";
import {
  getGlmUsage,
  getQoderUsage,
} from "./usage/misc.js";

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
// provider → usage handler (ctx carries every arg each handler needs)
const USAGE_HANDLERS: Record<string, any> = {
  antigravity: (c: any) => getAntigravityUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  claude: (c: any) => getClaudeUsage(c.accessToken, c.proxyOptions),
  codex: (c: any) => getCodexUsage(c.accessToken, c.proxyOptions),
  qoder: (c: any) => getQoderUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  glm: (c: any) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  "glm-cn": (c: any) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  "codebuddy-intl-cli": (c: any) => getCodeBuddyIntlCliUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  "grok-cli": (c: any) => getGrokCliUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  deepseek: (c: any) => getDeepseekUsage(c.apiKey, c.proxyOptions),
  "deepseek-harness": (c: any) => getDeepseekHarnessUsage(c.accessToken, c.proxyOptions),
};

export async function getUsageForProvider(connection: any, proxyOptions: any = null) {
  const { provider, accessToken, apiKey, providerSpecificData } = connection;

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  return await handler({ provider, accessToken, apiKey, providerSpecificData, proxyOptions });
}
