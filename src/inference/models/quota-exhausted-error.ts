// MiniMax's error codes for a Provider Account that is out of plan quota:
// 2056 (usage limit exceeded) and 2067 (plan limit reached with Credits off).
const QUOTA_EXHAUSTED_CODES = new Set([2056, 2067]);

// MiniMax's Anthropic-compatible endpoint puts the code at the end of the
// message only, e.g. "usage limit exceeded, ... resets at <time> (2056)".
const CODE_AT_END_OF_MESSAGE = /\((\d+)\)\s*$/;

/**
 * Whether a failed upstream answer says its Provider Account ran out of plan
 * quota (GLOSSARY "Exhausted"), rather than failing in a way a Cooldown fits.
 */
export function isQuotaExhaustedError(responseBody: string): boolean {
  const body = parsedObject(responseBody);
  if (body === null) {
    return false;
  }
  return errorCodesOf(body).some((code) => QUOTA_EXHAUSTED_CODES.has(code));
}

/** The codes the error names: `base_resp.status_code`, `status_code`, `code`, and the one in `error.message`. */
function errorCodesOf(body: Record<string, unknown>): number[] {
  const baseResp = objectOrNull(body.base_resp);
  const error = objectOrNull(body.error);
  const message = typeof error?.message === "string" ? error.message : null;
  const codes = [baseResp?.status_code, body.status_code, body.code, codeAtEndOf(message)];
  // A code may be sent as a number or as a numeric string.
  return codes.flatMap((code) =>
    typeof code === "number" || typeof code === "string" ? [Number(code)] : [],
  );
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
