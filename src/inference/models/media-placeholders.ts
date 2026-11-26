const DATA_URI = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s;
const BYTES_PER_KB = 1024;

export function withMediaPlaceholders(body: unknown): unknown {
  if (typeof body === 'string') {
    return placeholderOf(body) ?? body;
  }
  if (Array.isArray(body)) {
    return body.map(withMediaPlaceholders);
  }
  if (typeof body === 'object' && body !== null) {
    return Object.fromEntries(
      Object.entries(body).map(([name, value]) => [name, withMediaPlaceholders(value)]),
    );
  }
  return body;
}

function placeholderOf(text: string): string | null {
  const match = DATA_URI.exec(text);
  if (!match) {
    return null;
  }
  const [, mediaType, parameters, payload] = match;
  const isBase64 = parameters.split(';').includes('base64');
  const bytes = isBase64 ? Buffer.byteLength(payload, 'base64') : payload.length;
  return `<${mediaType || 'application/octet-stream'}, ${sizeOf(bytes)}>`;
}

function sizeOf(bytes: number): string {
  return bytes < BYTES_PER_KB ? `${bytes} B` : `${Math.round(bytes / BYTES_PER_KB)} KB`;
}
