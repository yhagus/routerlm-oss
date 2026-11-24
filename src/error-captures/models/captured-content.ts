export const REDACTED = "[REDACTED]";

export const MAX_CAPTURED_BODY_BYTES = 256 * 1024;

const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
]);

const UTF8_CONTINUATION_MASK = 0b1100_0000;
const UTF8_CONTINUATION_BITS = 0b1000_0000;

export type RawHeaders = Record<string, string | string[] | undefined>;

export function capturedHeaders(headers: RawHeaders, secrets: string[]): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    captured[name] = CREDENTIAL_HEADERS.has(name.toLowerCase())
      ? REDACTED
      : withoutSecrets(Array.isArray(value) ? value.join(", ") : value, secrets);
  }
  return captured;
}

export function capturedBody(body: string, secrets: string[]): string {
  const bytes = Buffer.from(withoutSecrets(body, secrets));
  if (bytes.length <= MAX_CAPTURED_BODY_BYTES) {
    return bytes.toString();
  }
  let end = MAX_CAPTURED_BODY_BYTES;
  while (end > 0 && (bytes[end] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_BITS) {
    end--;
  }
  const marker = `\n[truncated: ${bytes.length} bytes in total, ${MAX_CAPTURED_BODY_BYTES / 1024} KB kept]`;
  return bytes.subarray(0, end).toString() + marker;
}

function withoutSecrets(text: string, secrets: string[]): string {
  return secrets.reduce(
    (redacted, secret) => (secret === "" ? redacted : redacted.replaceAll(secret, REDACTED)),
    text,
  );
}
