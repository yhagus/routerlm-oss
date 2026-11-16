// MiniMax's Anthropic-compatible endpoint puts the code at the end of the
// message only, e.g. "usage limit exceeded, ... resets at <time> (2056)".
const CODE_AT_END_OF_MESSAGE = /\((\d+)\)\s*$/;

// How deep into an error body a named code is looked for; real ones sit two
// or three objects down (`error.code`, `error.error.type`).
const NAMED_CODE_SEARCH_DEPTH = 4;

const MS_PER_SECOND = 1000;

/** One entry of a Provider's `exhaustedErrorCodes` quirk: MiniMax numbers its codes, Kimi names them. */
export type ExhaustedErrorCode = number | string;

/**
 * Whether an upstream answer says its Provider Account is Exhausted
 * (GLOSSARY), with one of the codes its Provider's `exhaustedErrorCodes`
 * quirk names, rather than failing in a way a Cooldown fits.
 */
export function isQuotaExhaustedError(
  responseBody: string,
  exhaustedErrorCodes: readonly ExhaustedErrorCode[],
): boolean {
  if (exhaustedErrorCodes.length === 0) {
    return false;
  }
  const body = parsedObject(responseBody);
  if (body === null) {
    return false;
  }
  const numericCodes = numericErrorCodesOf(body);
  const namedCodes = namedErrorCodesOf(body, NAMED_CODE_SEARCH_DEPTH);
  return exhaustedErrorCodes.some((code) =>
    typeof code === "number" ? numericCodes.includes(code) : namedCodes.includes(code),
  );
}

/**
 * When an Exhausted refusal says the Provider Account's quota resets: OpenAI
 * Codex sends `error.resets_at` in epoch seconds. Null when it doesn't say.
 */
export function exhaustedUntilOf(responseBody: string): Date | null {
  const error = objectOrNull(parsedObject(responseBody)?.error);
  const resetsAt = error?.resets_at;
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) {
    return null;
  }
  return new Date(resetsAt * MS_PER_SECOND);
}

/** The codes the error numbers: `base_resp.status_code`, `status_code`, `code`, and the one in `error.message`. */
function numericErrorCodesOf(body: Record<string, unknown>): number[] {
  const baseResp = objectOrNull(body.base_resp);
  const error = objectOrNull(body.error);
  const message = typeof error?.message === "string" ? error.message : null;
  const codes = [baseResp?.status_code, body.status_code, body.code, codeAtEndOf(message)];
  // A code may be sent as a number or as a numeric string.
  return codes.flatMap((code) =>
    typeof code === "number" || typeof code === "string" ? [Number(code)] : [],
  );
}

/** Every string under a `code` or `type` key of the body and of the objects nested in it. */
function namedErrorCodesOf(body: Record<string, unknown>, depth: number): string[] {
  const names = [body.code, body.type].flatMap((value) =>
    typeof value === "string" ? [value] : [],
  );
  if (depth === 1) {
    return names;
  }
  const namesInNestedObjects = Object.values(body).flatMap((value) => {
    const nested = objectOrNull(value);
    return nested === null ? [] : namedErrorCodesOf(nested, depth - 1);
  });
  return [...names, ...namesInNestedObjects];
}

function codeAtEndOf(message: string | null): string | null {
  return message?.match(CODE_AT_END_OF_MESSAGE)?.[1] ?? null;
}

function parsedObject(text: string): Record<string, unknown> | null {
  try {
    return objectOrNull(JSON.parse(text));
  } catch {
    return null;
  }
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}
