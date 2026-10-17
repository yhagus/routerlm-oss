import crypto from "node:crypto";

const PREFIX = "g2a_compact_v1.";
const VERSION = 1;
const MAX_SUMMARY_BYTES = 8 << 20;
const MIN_SUMMARY_CHARS = 500;
const COMPACTION_PROMPT = "Your task is to produce a faithful, concise summary of the conversation so far so that a successor assistant can continue the work seamlessly after the earlier turns are discarded. The successor will see the user's original query plus this summary. Capture what is needed to continue, including explicit requests, recent actions, key technical details, file paths, commands, configuration, and architectural decisions. Be economical and focused.";

function secret() {
  return process.env.GROK_CLI_COMPACTION_SECRET || process.env.API_KEY_SECRET || "lobakai-grok-cli-compaction-secret";
}

function key() {
  return crypto.createHash("sha256").update(secret()).digest();
}

export function encodeGrokCliCompaction(session: any, summary: any) {
  const text = String(summary || "").trim();
  if (!text || Buffer.byteLength(text) > MAX_SUMMARY_BYTES) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const payload = Buffer.from(JSON.stringify({ version: VERSION, session: String(session || ""), summary: text }));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decodeGrokCliCompaction(session: any, blob: any) {
  if (typeof blob !== "string" || !blob.startsWith(PREFIX)) return { owned: false, summary: null };
  try {
    const [ivText, tagText, dataText] = blob.slice(PREFIX.length).split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8"));
    if (value.version !== VERSION || value.session !== String(session || "") || !value.summary) return { owned: true, summary: null };
    return { owned: true, summary: value.summary };
  } catch {
    return { owned: true, summary: null };
  }
}

export function prepareGrokCliCompaction(body: any, session: any) {
  const next = { ...body, input: Array.isArray(body.input) ? [...body.input] : [] };
  next.input = next.input.map((item: any) => {
    if (item?.type !== "compaction") return item;
    const decoded = decodeGrokCliCompaction(session, item.encrypted_content);
    if (decoded.owned && decoded.summary) return { type: "message", role: "user", content: decoded.summary };
    return { type: "message", role: "developer", content: "A prior compacted context could not be decoded by this lobakai instance. Continue from the retained conversation messages." };
  });
  next.input.push({ type: "message", role: "user", content: COMPACTION_PROMPT });
  next.instructions = null;
  next.stream = true;
  next.store = false;
  next.temperature = 1;
  next.reasoning = { summary: "concise" };
  delete next.previous_response_id;
  delete next.text;
  delete next.response_format;
  delete next.max_output_tokens;
  delete next._compact;
  return next;
}

export function cleanGrokCliCompactionSummary(value: any) {
  let text = String(value || "").trim();
  text = text.replace(/^<analysis>[\s\S]*?<\/analysis>\s*/i, "");
  text = text.replace(/<summary>([\s\S]*?)<\/summary>/gi, "$1");
  text = text.replace(/<\/?(?:analysis|summary|summary_request)>/gi, "").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

export function isValidGrokCliCompactionSummary(value: any) {
  return cleanGrokCliCompactionSummary(value).length >= MIN_SUMMARY_CHARS;
}

export function buildGrokCliCompactionResponse(response: any, session: any, streaming = false) {
  const output = Array.isArray(response?.output) ? response.output : [];
  const text = output
    .filter((item: any) => item?.type === "message")
    .flatMap((item: any) => Array.isArray(item.content) ? item.content : [item])
    .map((item: any) => item?.text || item?.content || "")
    .join("\n");
  const summary = cleanGrokCliCompactionSummary(text);
  if (!isValidGrokCliCompactionSummary(summary)) return response;
  const blob = encodeGrokCliCompaction(session, `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n${summary}`);
  if (!blob) return response;
  return { ...response, output: [{ type: "compaction", encrypted_content: blob }] };
}

export { COMPACTION_PROMPT };
