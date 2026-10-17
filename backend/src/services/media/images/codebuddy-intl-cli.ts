import { nowSec } from "./_base.ts";
import { randomUUID } from "node:crypto";

const CODEBUDDY_ORIGIN = "https://www.codebuddy.ai";
const CLI_VERSION = "2.154.0";
const CLI_USER_AGENT = `CLI/${CLI_VERSION} CodeBuddy/${CLI_VERSION}`;

export default {
  fetchTimeoutMs: 180_000,

  buildUrl: () => `${CODEBUDDY_ORIGIN}/v2/images/generations`,

  buildHeaders: (credentials: any) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "Origin": CODEBUDDY_ORIGIN,
      "User-Agent": CLI_USER_AGENT,
      "X-Product": "SaaS",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "X-IDE-Version": CLI_VERSION,
      "X-Private-Data": "false",
      "X-Agent-Type": "main",
      "X-Agent-Intent": "craft",
    };

    const psd =
      credentials?.providerSpecificData &&
      typeof credentials.providerSpecificData === "object"
        ? credentials.providerSpecificData
        : {};

    const uid = credentials?.codebuddyUserId || psd.codebuddyUserId;
    const enterpriseId =
      credentials?.codebuddyEnterpriseId || psd.codebuddyEnterpriseId;
    const domain = credentials?.codebuddyDomain || psd.codebuddyDomain;

    if (uid) headers["X-User-Id"] = String(uid);
    else headers["X-No-User-Id"] = "1";
    if (enterpriseId) headers["X-Enterprise-Id"] = String(enterpriseId);
    else headers["X-No-Enterprise-Id"] = "1";
    if (domain) headers["X-Domain"] = String(domain);
    else headers["X-No-Department-Info"] = "1";

    const sessionId = randomUUID().replace(/-/g, "");
    const conversationRequestId = randomUUID().replace(/-/g, "");
    const messageId = randomUUID().replace(/-/g, "");
    headers["X-Request-ID"] = messageId;
    headers["X-Conversation-ID"] = sessionId;
    headers["X-Session-ID"] = sessionId;
    headers["X-Conversation-Request-ID"] = conversationRequestId;
    headers["X-Conversation-Message-ID"] = messageId;

    const token = credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    return headers;
  },

  buildBody: (model: string, body: any) => {
    const payload: Record<string, any> = {
      model,
      prompt: body.prompt,
      size: body.size || "1024x1024",
    };
    if (body.n) payload.n = body.n;
    if (body.quality) payload.quality = body.quality;
    return payload;
  },

  normalize: (responseBody: any, _prompt: any) => {
    const data = responseBody?.data;
    const images = Array.isArray(data?.data)
      ? data.data
          .map((item: any) => {
            if (item?.url) return { url: item.url };
            if (item?.b64_json) return { b64_json: item.b64_json };
            return null;
          })
          .filter(Boolean)
      : [];
    return {
      created: data?.created || nowSec(),
      data:
        images.length > 0
          ? images
          : [{ url: "", revised_prompt: _prompt }],
    };
  },
};
