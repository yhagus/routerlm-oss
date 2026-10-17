import { createHash } from "node:crypto";
import { APP_ID, APP_KEY } from "../chat/autoclawExecutor";

const PROFILE_URL = "https://autoglm-api.autoglm.ai/userapi/v1/user-profile";

export interface AutoclawAccount {
  email: string;
  userId: string;
}

// The profile endpoint is the authoritative source for an AutoClaw account email.
export async function fetchAutoclawAccount(
  accessToken: string,
  deviceId: string,
): Promise<AutoclawAccount | null> {
  const token = accessToken.replace(/^Bearer\s+/i, "").trim();
  if (!token || !deviceId) return null;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = createHash("md5").update(`${APP_ID}&${timestamp}&${APP_KEY}`).digest("hex");
  try {
    const response = await fetch(PROFILE_URL, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        origin: "https://autoclaw.z.ai",
        referer: "https://autoclaw.z.ai/",
        "x-auth-appid": APP_ID,
        "x-auth-sign": sign,
        "x-auth-timestamp": timestamp,
        "x-channel": "official",
        "x-client-type": "web",
        "x-lang": "en",
        "x-product": "autoclaw",
        "x-tm": "web",
        "x-trace-id": crypto.randomUUID(),
        "x-version": "1.12.1",
      },
      body: JSON.stringify({ source_id: "autoclaw", device_id: deviceId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { code?: number; data?: { email?: unknown; user_id?: unknown } };
    const email = typeof body.data?.email === "string" ? body.data.email.trim().toLowerCase() : "";
    if (body.code !== 0 || !email) return null;
    return { email, userId: typeof body.data?.user_id === "string" ? body.data.user_id : "" };
  } catch {
    return null;
  }
}
