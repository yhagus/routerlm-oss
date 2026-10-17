// Strip request params a given provider/model rejects upstream (e.g. HTTP 400).
// Config-driven: add a rule instead of scattering `delete body.x` across executors.

// Each rule: optional provider, regex match on model, list of params to drop.
// A param is removed only when it is present (!== undefined).
const STRIP_RULES: Array<{ provider?: string; match?: RegExp | ((model: any) => boolean); drop?: string[] }> = [
  // All Claude models: temperature deprecated/rejected upstream (Anthropic 400). #1748
  { match: /claude/i, drop: ["temperature"] },
];

// Test a rule's match (regex or predicate) against the model id.
function matches(rule: any, model: any) {
  if (!rule.match) return true;
  return typeof rule.match === "function" ? rule.match(model) : rule.match.test(model);
}

// Remove unsupported params from body in place; returns body.
export function stripUnsupportedParams(provider: any, model: any, body: any) {
  if (!model || !body || typeof body !== "object") return body;
  for (const rule of STRIP_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    for (const key of rule.drop || []) {
      if (body[key] !== undefined) delete body[key];
    }
  }
  return body;
}
