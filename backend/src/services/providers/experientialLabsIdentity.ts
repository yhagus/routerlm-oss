const WHOAMI_URL = "https://api.experientiallabs.ai/api/whoami";

export interface ExperientialLabsAccount {
  orgId: string;
  orgSlug: string;
  orgName: string;
}

// The whoami endpoint is the authoritative source for an Experiential Labs
// account identity. Returns null when the key is invalid or upstream fails.
export async function fetchExperientialLabsAccount(
  apiKey: string,
): Promise<ExperientialLabsAccount | null> {
  const token = apiKey.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const response = await fetch(WHOAMI_URL, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as {
      org_id?: unknown;
      org_slug?: unknown;
      org_name?: unknown;
    } | null;
    const orgSlug = typeof body?.org_slug === "string" ? body.org_slug.trim().toLowerCase() : "";
    if (!orgSlug) return null;
    return {
      orgId: typeof body?.org_id === "string" ? body.org_id : "",
      orgSlug,
      orgName: typeof body?.org_name === "string" ? body.org_name : "",
    };
  } catch {
    return null;
  }
}
