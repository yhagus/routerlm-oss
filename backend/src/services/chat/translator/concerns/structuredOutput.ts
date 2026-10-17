// Synthesize a `name` for OpenAI Responses `text.format` json_schema blocks.
// OpenAI Responses requires text.format.name whenever text.format.type is
// "json_schema". Client formats that omit it (Claude output_config, Chat
// Completions response_format) fail upstream with "Missing required parameter:
// 'text.format.name'" without this.
const MAX_NAME_LEN = 64;
const DEFAULT_NAME = "structured_output";
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]+/g;

function toValidName(raw: any) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(INVALID_NAME_CHARS, "_")
    // Identifiers cannot start with a digit or hyphen.
    .replace(/^[^A-Za-z_]+/, "")
    // Drop trailing separators produced by the replacement.
    .replace(/[_-]+$/, "")
    .slice(0, MAX_NAME_LEN);
}

// Return a copy of a Responses text.format object with a valid `name` present.
// Preserve an existing non-empty name; otherwise synthesize one from the schema
// title or $id, falling back to a constant. Non-json_schema formats pass through.
export function ensureStructuredOutputName(format: any) {
  if (!format || typeof format !== "object" || Array.isArray(format)) return format;
  if (format.type !== "json_schema") return format;
  const existing = typeof format.name === "string" && format.name.trim() !== "" ? format.name : "";
  if (existing) return { ...format, name: existing };
  const schema = format.schema && typeof format.schema === "object" && !Array.isArray(format.schema)
    ? format.schema
    : {};
  const name = toValidName(schema.title) || toValidName(schema.$id) || DEFAULT_NAME;
  return { ...format, name };
}
