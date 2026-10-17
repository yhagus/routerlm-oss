import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { VoiceError, connectionApiKey, deepgramVoices, elevenlabsVoices, genericVoices, inworldVoices } from "../services/media/voiceCatalog";

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof VoiceError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { "content-type": "application/json" } });
  const message = error instanceof Error ? error.message : fallback;
  return Response.json({ error: message }, { status: 502 });
}

export function mediaProviderRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/tts/voices", async (c) => {
      try {
        return c.json(await genericVoices(c.req.query("provider") || "edge-tts", c.req.query("lang"), c.req.query("apiKey")));
      } catch (error: any) {
        return errorResponse(error, "Failed to fetch voices");
      }
    })
    .get("/tts/elevenlabs/voices", async (c) => {
      try {
        const apiKey = connectionApiKey(runtime, "elevenlabs");
        if (!apiKey) return c.json({ error: "No ElevenLabs connection found" }, 400);
        return c.json(await elevenlabsVoices(apiKey, c.req.query("lang")));
      } catch (error: any) {
        return errorResponse(error, "Failed to fetch voices");
      }
    })
    .get("/tts/deepgram/voices", async (c) => {
      try {
        const apiKey = connectionApiKey(runtime, "deepgram");
        if (!apiKey) return c.json({ error: "No Deepgram connection found" }, 400);
        return c.json(await deepgramVoices(apiKey, c.req.query("lang")));
      } catch (error: any) {
        return errorResponse(error, "Failed to fetch voices");
      }
    })
    .get("/tts/inworld/voices", async (c) => {
      try {
        const apiKey = connectionApiKey(runtime, "inworld");
        if (!apiKey) return c.json({ error: "No Inworld connection found" }, 400);
        return c.json(await inworldVoices(apiKey, c.req.query("lang")));
      } catch (error: any) {
        return errorResponse(error, "Failed to fetch voices");
      }
    });
}
