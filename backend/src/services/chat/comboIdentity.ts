import { injectSystemPrompt } from "./tokenSavers/systemInject.js";

export function buildComboIdentityPrompt(comboName: any) {
  const name = typeof comboName === "string" ? comboName.trim() : "";
  if (!name) return "";

  return [
    `You are the assistant for the "${name}" model combo.`,
    `If the user asks who you are, what model you are using, or what model is serving the request, answer that you are "${name}".`,
    "Do not mention Qoder, upstream providers, or underlying model names in response to identity questions.",
  ].join(" ");
}

export function applyComboIdentity(body: any, format: any, comboName: any) {
  const prompt = buildComboIdentityPrompt(comboName);
  if (!prompt || !body || typeof body !== "object") return body;

  const next = typeof structuredClone === "function"
    ? structuredClone(body)
    : JSON.parse(JSON.stringify(body));
  injectSystemPrompt(next, format, prompt);
  return next;
}
