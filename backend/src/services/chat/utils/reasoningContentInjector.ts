// Some thinking-mode providers (DeepSeek, Kimi, MiniMax, ...) require reasoning_content
// to be echoed back on assistant messages. Clients in OpenAI format don't send it,
// so we inject a non-empty placeholder to satisfy upstream validation.
import { PROVIDERS } from "../../providers/config/providers.ts";

const PLACEHOLDER = " ";

// Provider-level rules derive from registry transport.reasoningInject (single source)
const providerRuleFor = (provider: any) => PROVIDERS[provider]?.reasoningInject;

// Model-level rules: matched by predicate against model id
const MODEL_RULES = [
  { match: (m: any) => /^kimi-/i.test(m || ""), scope: "toolCalls" },
  { match: (m: any) => /deepseek/i.test(m || ""), scope: "all" }
];

const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
const DEEPSEEK_V4_PRO_ALIASES = {
  [`${DEEPSEEK_V4_PRO}-max`]: {
    thinkingType: "enabled",
    reasoningEffort: "max"
  },
  [`${DEEPSEEK_V4_PRO}-none`]: {
    thinkingType: "disabled",
    reasoningEffort: null
  }
};

function shouldInject(message: any, scope: any) {
  if (message?.role !== "assistant") return false;
  const rc = message.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return false;
  if (scope === "toolCalls") return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}

function applyRule(body: any, rule: any) {
  if (!rule || !body?.messages) return body;
  const messages = body.messages.map((m: any) =>
    shouldInject(m, rule.scope) ? { ...m, reasoning_content: PLACEHOLDER } : m
  );
  return { ...body, messages };
}

function applyDeepSeekV4ProAlias({ provider, model, body }: any) {
  const alias = (DEEPSEEK_V4_PRO_ALIASES as Record<string, any>)[model];
  if (provider !== "deepseek" || !alias || !body) return body;

  const nextBody = {
    ...body,
    model: DEEPSEEK_V4_PRO,
    extra_body: {
      ...(body.extra_body || {}),
      thinking: {
        ...(body.extra_body?.thinking || {}),
        type: alias.thinkingType
      }
    }
  };

  if (alias.reasoningEffort) {
    nextBody.reasoning_effort = alias.reasoningEffort;
  } else {
    delete nextBody.reasoning_effort;
  }

  return nextBody;
}

export function injectReasoningContent({ provider, model, body }: any) {
  const providerRule = providerRuleFor(provider);
  const modelRule = MODEL_RULES.find(r => r.match(model));
  const rule = providerRule || modelRule;
  const nextBody = applyDeepSeekV4ProAlias({ provider, model, body });
  // Experiential Labs routes reject client-echoed reasoning_content they didn't
  // sign ("must be an authentic continuation for this route") — applies to every
  // model on the provider, not just GLM. Strip stale reasoning from history so
  // re-sends don't 400. Scoped to this provider only.
  if (provider === "experiential-labs") return stripInboundReasoning(nextBody);
  return applyRule(nextBody, rule);
}

function stripInboundReasoning(body: any) {
  if (!Array.isArray(body?.messages)) return body;
  const messages = body.messages.map((m: any) => {
    if (m?.role !== "assistant" || !("reasoning_content" in m)) return m;
    const { reasoning_content, ...rest } = m;
    return rest;
  });
  return { ...body, messages };
}
