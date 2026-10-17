import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { getProviderMetadata } from "../src/services/providers/providerCatalog";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-voices-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("v1 media provider voice routes", () => {
  test("generic voices route rejects unsupported providers and groups edge-tts voices by language", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const unsupported = await app.request("/api/media-providers/tts/voices?provider=openai");
      expect(unsupported.status).toBe(400);
      expect((await unsupported.json()).error).toContain("does not support voice listing");

      globalThis.fetch = (async () => new Response(JSON.stringify([
        { ShortName: "en-US-AriaNeural", FriendlyName: "Microsoft Aria Online (Natural) - English (United States)", Locale: "en-US", Gender: "Female" },
        { ShortName: "vi-VN-HoaiMyNeural", FriendlyName: "Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)", Locale: "vi-VN", Gender: "Female" },
      ]), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

      const payload = await (await app.request("/api/media-providers/tts/voices?provider=edge-tts")).json();
      expect(payload.voices.length).toBe(2);
      expect(Object.keys(payload.byLang).sort()).toEqual(["en", "vi"]);
      expect(payload.byLang.en.voices.map((voice: { id: string }) => voice.id)).toEqual(["en-US-AriaNeural"]);

      const filtered = await (await app.request("/api/media-providers/tts/voices?provider=edge-tts&lang=vi")).json();
      expect(filtered.voices.map((voice: { id: string }) => voice.id)).toEqual(["vi-VN-HoaiMyNeural"]);
    } finally {
      instance.close();
    }
  });

  test("elevenlabs voices require a connection and group verified languages", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const missing = await app.request("/api/media-providers/tts/elevenlabs/voices");
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ error: "No ElevenLabs connection found" });

      const apiKey = `el-key-${crypto.randomUUID()}`;
      instance.repos.providers.create({ provider: "elevenlabs", authType: "apikey", credentials: { apiKey } });
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.elevenlabs.io/v1/voices");
        expect((init?.headers as Record<string, string>)["xi-api-key"]).toBe(apiKey);
        return new Response(JSON.stringify({ voices: [
          { voice_id: "voice-1", name: "Rachel", category: "premade", labels: { language: "en", gender: "female" }, verified_languages: [{ language: "es" }] },
          { voice_id: "voice-2", name: "Adam", category: "professional", is_owner: false, labels: { language: "en", gender: "male" } },
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch;

      const payload = await (await app.request("/api/media-providers/tts/elevenlabs/voices")).json();
      expect(Object.keys(payload.byLang).sort()).toEqual(["en", "es"]);
      expect(payload.byLang.en.voices).toEqual([
        { id: "voice-1", name: "Rachel", gender: "female", lang: "en", free_users_allowed: true },
        { id: "voice-2", name: "Adam", gender: "male", lang: "en", free_users_allowed: false },
      ]);
      expect(payload.byLang.es.voices).toEqual([{ id: "voice-1", name: "Rachel", gender: "female", lang: "es", free_users_allowed: true }]);

      const langOnly = await (await app.request("/api/media-providers/tts/elevenlabs/voices?lang=es")).json();
      expect(langOnly).toEqual({ voices: [{ id: "voice-1", name: "Rachel", gender: "female", lang: "es", free_users_allowed: true }] });
    } finally {
      instance.close();
    }
  });

  test("gateway voices endpoint validates provider and returns speech-ready model ids", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const invalid = await app.request("/v1/audio/voices");
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).error.message).toContain("provider must be one of:");

      globalThis.fetch = (async () => new Response(JSON.stringify([
        { ShortName: "en-US-AriaNeural", FriendlyName: "Microsoft Aria Online (Natural) - English (United States)", Locale: "en-US", Gender: "Female" },
        { ShortName: "vi-VN-HoaiMyNeural", FriendlyName: "Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)", Locale: "vi-VN", Gender: "Female" },
      ]), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

      const payload = await (await app.request("/v1/audio/voices?provider=edge-tts&lang=en")).json();
      expect(payload.object).toBe("list");
      expect(payload.data.length).toBe(1);
      const alias = getProviderMetadata("edge-tts")?.alias || "edge-tts";
      const firstId = payload.data[0].id;
      const firstName = payload.data[0].name;
      expect(payload.data[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), lang: "en", gender: "Female" });
      expect(payload.data[0].model).toBe(`${alias}/${firstId}`);
      // v1's display transform leaves the paren unbalanced; keep it verbatim.
      expect(firstName).toBe("Aria (English (United States)");

      const missing = await app.request("/v1/audio/voices?provider=deepgram");
      expect(missing.status).toBe(400);
      expect((await missing.json()).error.message).toContain("No deepgram connection found");
    } finally {
      instance.close();
    }
  });
});
