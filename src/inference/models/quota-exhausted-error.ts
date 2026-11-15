// MiniMax's Anthropic-compatible endpoint puts the code at the end of the
// message only, e.g. "usage limit exceeded, ... resets at <time> (2056)".
const CODE_AT_END_OF_MESSAGE = /\((\d+)\)\s*$/;

/**
 * Whether an upstream answer says its Provider Account is Exhausted
 * (GLOSSARY), with one of the codes its Provider's `exhaustedErrorCodes`
 * quirk names, rather than failing in a way a Cooldown fits.
 */
export function isQuotaExhaustedError(
  responseBody: string,
  exhaustedErrorCodes: readonly number[],
): boolean {
  if (exhaustedErrorCodes.length === 0) {
    return false;
  }
  const body = parsedObject(responseBody);
  if (body === null) {
    return false;
  }
  return errorCodesOf(body).some((code) => exhaustedErrorCodes.includes(code));
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
