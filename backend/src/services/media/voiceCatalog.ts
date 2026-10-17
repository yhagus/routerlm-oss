import type { Runtime } from "../../runtime";
// Reuse v1's self-contained voice fetchers; they are pure HTTP/system helpers
// with no Next.js runtime dependency (same policy as the token refresh adapters).
import { fetchEdgeTtsVoices } from "./tts/edgeTts.ts";
import { fetchLocalDeviceVoices } from "./tts/localDevice.ts";
import { fetchElevenLabsVoices } from "./tts/elevenlabs.ts";

const VOICE_FETCHERS: Record<string, (apiKey?: string) => Promise<Array<Record<string, any>>>> = {
  "edge-tts": fetchEdgeTtsVoices,
  "local-device": fetchLocalDeviceVoices,
  elevenlabs: fetchElevenLabsVoices,
};

const LOCALE_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const LANG_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

function countryName(code: string): string {
  try { return LOCALE_NAMES.of(code) || code; } catch { return code; }
}
function langName(code: string): string {
  try { return LANG_NAMES.of(code) || code; } catch { return code; }
}

function groupByLang(voices: Array<Record<string, unknown>>, keyOf: (voice: Record<string, unknown>) => { lang: string; langName: string }) {
  const byLang: Record<string, { code: string; name: string; voices: Array<Record<string, unknown>> }> = {};
  for (const voice of voices) {
    const { lang, langName: name } = keyOf(voice);
    if (!byLang[lang]) byLang[lang] = { code: lang, name, voices: [] as any[]};
    byLang[lang].voices.push(voice);
  }
  return byLang;
}

// Port of GET /api/media-providers/tts/voices (edge-tts default shape).
export async function genericVoices(provider: string, langFilter: string | null | undefined, apiKey?: string | null) {
  const fetcher = VOICE_FETCHERS[provider];
  if (!fetcher) throw new VoiceError(`Provider '${provider}' does not support voice listing`, 400);
  const raw = provider === "elevenlabs" ? await fetcher(apiKey || undefined) : await fetcher();
  const useElevenShape = provider === "elevenlabs";

  let voices: Array<Record<string, unknown>>;
  if (provider === "local-device") {
    voices = raw.map((voice) => ({
      id: voice.id,
      name: voice.name,
      locale: String(voice.locale).replace("_", "-"),
      lang: voice.lang,
      country: voice.country,
      countryName: countryName(voice.country),
      langName: langName(voice.lang),
      gender: voice.gender,
    }));
  } else if (useElevenShape) {
    voices = raw.map((voice) => {
      const language = voice.labels?.language || "en";
      return {
        id: voice.voice_id,
        name: voice.name,
        locale: language,
        lang: String(language).split("-")[0],
        country: "",
        countryName: "",
        langName: langName(String(language).split("-")[0]),
        gender: voice.labels?.gender || "",
        category: voice.category,
      };
    });
  } else {
    voices = raw.map((voice) => {
      const [lang, country] = String(voice.Locale).split("-");
      return {
        id: voice.ShortName,
        name: String(voice.FriendlyName || voice.ShortName)
          .replace("Microsoft ", "")
          .replace(/ Online \(Natural\) - /g, " ("),
        locale: voice.Locale,
        lang,
        country: country || "",
        countryName: countryName(country || lang),
        langName: langName(lang),
        gender: voice.Gender,
      };
    });
  }

  if (langFilter) voices = voices.filter((voice) => voice.lang === langFilter);
  const byLang = groupByLang(voices, (voice) => ({ lang: String(voice.lang), langName: String(voice.langName || langName(String(voice.lang))) }));
  const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));
  return { voices, languages, byLang };
}

export class VoiceError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function elevenlabsVoices(apiKey: string, langFilter: string | null | undefined) {
  const voices = await fetchElevenLabsVoices(apiKey);
  const byLang: Record<string, { code: string; name: string; voices: Array<Record<string, unknown>> }> = {};
  const addToLang = (code: string, voice: Record<string, any>) => {
    if (!byLang[code]) byLang[code] = { code, name: langName(code), voices: [] as any[]};
    if (!byLang[code].voices.some((item) => item.id === voice.voice_id)) {
      byLang[code].voices.push({
        id: voice.voice_id,
        name: voice.name,
        gender: voice.labels?.gender || "",
        lang: code,
        // premade voices are free; professional library voices may require a paid plan
        free_users_allowed: voice.category === "premade" || voice.is_owner === true,
      });
    }
  };
  for (const voice of voices) {
    const primaryLang = voice.labels?.language || "en";
    addToLang(primaryLang, voice);
    for (const verified of voice.verified_languages || []) {
      if (verified.language && verified.language !== primaryLang) addToLang(verified.language, voice);
    }
  }
  const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));
  if (langFilter) return { voices: byLang[langFilter]?.voices || [] };
  return { languages, byLang };
}

export async function deepgramVoices(apiKey: string, langFilter: string | null | undefined) {
  const response = await fetch("https://api.deepgram.com/v1/models", { headers: { authorization: `Token ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new VoiceError(`Deepgram API ${response.status}: ${text || "Failed"}`, 502);
  }
  const data = await response.json() as { tts?: Array<Record<string, any>> };
  const byLang: Record<string, { code: string; name: string; voices: Array<Record<string, unknown>> }> = {};
  for (const model of data.tts || []) {
    const langs = Array.isArray(model.languages) && model.languages.length
      ? model.languages.map(String)
      : [String(model.canonical_name?.split("-").pop() || "en")];
    for (const code of langs) {
      if (!byLang[code]) byLang[code] = { code, name: langName(code), voices: [] as any[]};
      const voiceId = model.canonical_name || model.name;
      if (!byLang[code].voices.some((item) => item.id === voiceId)) {
        byLang[code].voices.push({
          id: voiceId,
          name: model.name || voiceId,
          gender: model.metadata?.tags?.find((tag: string) => tag === "masculine" || tag === "feminine") || "",
          lang: code,
        });
      }
    }
  }
  const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));
  if (langFilter) return { voices: byLang[langFilter]?.voices || [] };
  return { languages, byLang };
}

export async function inworldVoices(apiKey: string, langFilter: string | null | undefined) {
  const response = await fetch("https://api.inworld.ai/tts/v1/voices", { headers: { authorization: `Basic ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new VoiceError(`Inworld API ${response.status}: ${text || "Failed"}`, 502);
  }
  const data = await response.json() as { voices?: Array<Record<string, any>> };
  const byLang: Record<string, { code: string; name: string; voices: Array<Record<string, unknown>> }> = {};
  for (const voice of data.voices || []) {
    const langs = Array.isArray(voice.languages) && voice.languages.length ? voice.languages.map(String) : ["en"];
    for (const code of langs) {
      if (!byLang[code]) byLang[code] = { code, name: langName(code), voices: [] as any[]};
      if (!byLang[code].voices.some((item) => item.id === voice.voiceId)) {
        byLang[code].voices.push({
          id: voice.voiceId,
          name: voice.displayName || voice.voiceId,
          gender: voice.gender || "",
          lang: code,
        });
      }
    }
  }
  const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));
  if (langFilter) return { voices: byLang[langFilter]?.voices || [] };
  return { languages, byLang };
}

// First active connection's API key for a media provider (v1 voice routes read
// the primary connection directly).
export function connectionApiKey(runtime: Runtime, provider: string): string | null {
  const connection = runtime.repos.providers.list().find((item) => item.provider === provider);
  const key = connection ? connection.credentials.apiKey ?? connection.data.apiKey : null;
  return typeof key === "string" && key ? key : null;
}
