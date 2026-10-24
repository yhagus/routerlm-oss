// Generated from the v1 provider registry (open-sse/providers/registry/*).
// Display metadata consumed by the provider pages: names, aliases, colors,
// notices, deprecation risk banners, auth modes, modelsFetcher configs, and
// region-aware providers. authModes may come from display or the entry top
// level (v1 byCategory merges both).

export interface ProviderMeta {
  alias?: string;
  name?: string;
  color?: string;
  textIcon?: string;
  notice?: { text?: string; apiKeyUrl?: string; signupUrl?: string };
  deprecated?: boolean;
  deprecationNotice?: string;
  website?: string;
  authType?: string;
  authHint?: string;
  authModes?: string[];
  modelsFetcher?: { url: string; type: string };
  regions?: Array<{ id: string; label: string }>;
  defaultRegion?: string;
  noAuth?: boolean;
  /** noAuth provider that also accepts API key accounts (e.g. paid models). */
  optionalApiKey?: boolean;
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  "alims-intl": {
    alias: "alims-intl",
    name: "Alibaba Studio",
    color: "#FF6A00",
    textIcon: "ALi",
    notice: {
      apiKeyUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    },
    website: "https://modelstudio.console.alibabacloud.com",
  },
  anthropic: {
    alias: "anthropic",
    name: "Anthropic",
    color: "#D97757",
    textIcon: "AN",
    notice: {
      apiKeyUrl: "https://console.anthropic.com/settings/keys",
    },
    website: "https://console.anthropic.com",
  },
  antigravity: {
    alias: "ag",
    name: "Antigravity",
    color: "#F59E0B",
    notice: {
      signupUrl: "https://antigravity.google",
    },
    deprecated: true,
    deprecationNotice:
      "⚠️ Risk Notice: This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk.",
    website: "https://antigravity.google",
  },
  assemblyai: {
    alias: "assemblyai",
    name: "AssemblyAI",
    color: "#0062FF",
    textIcon: "AA",
    notice: {
      apiKeyUrl: "https://www.assemblyai.com/app/api-keys",
    },
    website: "https://assemblyai.com",
  },
  "aws-polly": {
    alias: "polly",
    name: "AWS Polly",
    color: "#FF9900",
    textIcon: "PL",
    notice: {
      text: "Use AWS Secret Access Key as API key; set providerSpecificData.accessKeyId and optional region.",
      apiKeyUrl:
        "https://console.aws.amazon.com/iam/home#/security_credentials",
    },
    website: "https://aws.amazon.com/polly/",
  },
  "black-forest-labs": {
    alias: "black-forest-labs",
    name: "Black Forest Labs",
    color: "#111827",
    textIcon: "BF",
    notice: {
      apiKeyUrl: "https://api.bfl.ai",
    },
    website: "https://blackforestlabs.ai",
  },
  "brave-search": {
    alias: "brave",
    name: "Brave Search",
    color: "#FB542B",
    textIcon: "BR",
    notice: {
      apiKeyUrl: "https://api-dashboard.search.brave.com/app/keys",
    },
    website: "https://brave.com/search/api",
  },
  cartesia: {
    alias: "cartesia",
    name: "Cartesia",
    color: "#FF4F8B",
    textIcon: "CA",
    notice: {
      apiKeyUrl: "https://play.cartesia.ai/keys",
    },
    website: "https://cartesia.ai",
  },
  claude: {
    alias: "cc",
    name: "Claude Code",
    color: "#D97757",
    notice: {
      signupUrl: "https://claude.ai",
    },
    deprecated: true,
    deprecationNotice:
      "⚠️ Risk Notice: This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk.",
    website: "https://claude.ai",
  },
  "codebuddy-intl-cli": {
    alias: "cbai-cli",
    name: "CodeBuddy CLI",
    color: "#006EFF",
    notice: {
      signupUrl: "https://www.codebuddy.ai",
    },
    website: "https://www.codebuddy.ai",
    authModes: ["oauth", "apikey"],
  },
  codex: {
    alias: "cx",
    name: "OpenAI Codex",
    color: "#3B82F6",
    notice: {
      signupUrl: "https://chatgpt.com/codex",
    },
    deprecated: true,
    deprecationNotice:
      "⚠️ Risk Notice: This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk.",
    website: "https://chatgpt.com/codex",
  },
  comfyui: {
    alias: "comfyui",
    name: "ComfyUI",
    color: "#4CAF50",
    textIcon: "CF",
    website: "https://github.com/comfyanonymous/ComfyUI",
  },
  commandcode: {
    alias: "commandcode",
    name: "Command Code",
    color: "#000000",
    textIcon: "CC",
    notice: {
      text: "Use your CommandCode CLI API key (starts with user_...) from ~/.commandcode/auth.json or commandcode.ai/studio.",
      apiKeyUrl: "https://commandcode.ai/studio",
    },
    website: "https://commandcode.ai",
  },
  coqui: {
    alias: "coqui",
    name: "Coqui TTS",
    color: "#10B981",
    textIcon: "CQ",
    website: "https://github.com/coqui-ai/TTS",
    noAuth: true,
  },
  deepgram: {
    alias: "deepgram",
    name: "Deepgram",
    color: "#13EF93",
    textIcon: "DG",
    notice: {
      text: "$200 free credit on signup (no card required). Aura-1: $0.015/1k chars, Aura-2: $0.030/1k chars (Pay-As-You-Go).",
      apiKeyUrl: "https://console.deepgram.com/api-keys",
    },
    website: "https://deepgram.com",
  },
  deepseek: {
    alias: "deepseek",
    name: "DeepSeek",
    color: "#4D6BFE",
    textIcon: "DS",
    notice: {
      apiKeyUrl: "https://platform.deepseek.com/api_keys",
    },
    website: "https://deepseek.com",
  },
  "deepseek-harness": {
    alias: "dsh",
    name: "DeepSeek Harness",
    color: "#4D6BFE",
    textIcon: "DH",
    notice: {
      text: "Sign in with your DeepSeek account (browser OAuth). Inference uses the Anthropic Messages-compatible Harness endpoint.",
      signupUrl: "https://platform.deepseek.com",
    },
    website: "https://deepseek.com/harness",
    authModes: ["oauth"],
  },
  "edge-tts": {
    alias: "edge-tts",
    name: "Edge TTS",
    color: "#0078D4",
    textIcon: "ET",
    noAuth: true,
  },
  elevenlabs: {
    alias: "el",
    name: "ElevenLabs",
    color: "#6C47FF",
    textIcon: "EL",
    notice: {
      apiKeyUrl: "https://elevenlabs.io/app/settings/api-keys",
    },
    website: "https://elevenlabs.io",
  },
  exa: {
    alias: "exa",
    name: "Exa",
    color: "#2563EB",
    textIcon: "EX",
    notice: {
      apiKeyUrl: "https://dashboard.exa.ai/api-keys",
    },
    website: "https://exa.ai",
  },
  "fal-ai": {
    alias: "fal-ai",
    name: "Fal.ai",
    color: "#2563EB",
    textIcon: "FL",
    notice: {
      apiKeyUrl: "https://fal.ai/dashboard/keys",
    },
    website: "https://fal.ai",
  },
  "experiential-labs": {
    alias: "explabs",
    name: "Experiential Labs",
    color: "#10B981",
    textIcon: "EL",
    notice: {
      text: "OpenAI-compatible API. API key auth.",
      apiKeyUrl: "https://api.experientiallabs.ai",
    },
    website: "https://api.experientiallabs.ai",
    modelsFetcher: {
      url: "https://api.experientiallabs.ai/v1/models",
      type: "openai",
    },
  },
  firecrawl: {
    alias: "firecrawl",
    name: "Firecrawl",
    color: "#F59E0B",
    textIcon: "FC",
    notice: {
      apiKeyUrl: "https://www.firecrawl.dev/app/api-keys",
    },
    website: "https://firecrawl.dev",
  },
  "gmi-cloud": {
    alias: "gmicloud",
    name: "GMI Cloud",
    color: "#0EA5E9",
    textIcon: "GM",
    notice: {
      apiKeyUrl: "https://www.gmicloud.ai",
    },
    website: "https://www.gmicloud.ai",
    authModes: ["apikey"],
  },
  "bitdeer": {
    alias: "bitdeer",
    name: "BitDeer AI",
    color: "#36D0AC",
    textIcon: "BD",
    notice: {
      apiKeyUrl: "https://www.bitdeer.ai/en/model/apikeys",
    },
    website: "https://www.bitdeer.ai",
    authModes: ["apikey"],
    modelsFetcher: {
      url: "https://api-inference.bitdeer.ai/v1/models",
      type: "openai",
    },
  },
  "glm-cn": {
    alias: "glm-cn",
    name: "GLM (China)",
    color: "#DC2626",
    textIcon: "GC",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
    website: "https://open.bigmodel.cn",
  },
  glm: {
    alias: "glm",
    name: "GLM Coding",
    color: "#2563EB",
    textIcon: "GL",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
    website: "https://open.bigmodel.cn",
  },
  "google-pse": {
    alias: "gpse",
    name: "Google PSE",
    color: "#4285F4",
    textIcon: "GP",
    notice: {
      apiKeyUrl:
        "https://programmablesearchengine.google.com/controlpanel/create",
    },
    website: "https://programmablesearchengine.google.com",
  },
  "google-tts": {
    alias: "google-tts",
    name: "Google TTS",
    color: "#4285F4",
    textIcon: "GT",
    noAuth: true,
  },
  "grok-cli": {
    alias: "gcli",
    name: "Grok CLI (Grok Build)",
    color: "#1DA1F2",
    textIcon: "GC",
    notice: {
      text: "Sign in with your xAI / Grok account via device code. Uses Grok Build subscription credits (cli-chat-proxy.grok.com).",
      signupUrl: "https://grok.com/supergrok",
    },
    website: "https://x.ai",
    authModes: ["oauth"],
  },
  "grok-web": {
    alias: "grok-web",
    name: "Grok Web (Subscription)",
    color: "#1DA1F2",
    textIcon: "GW",
    website: "https://grok.com",
  },
  huggingface: {
    alias: "huggingface",
    name: "HuggingFace",
    color: "#FFD21E",
    textIcon: "HF",
    notice: {
      apiKeyUrl: "https://huggingface.co/settings/tokens",
    },
    website: "https://huggingface.co",
  },
  hyperbolic: {
    alias: "hyperbolic",
    name: "Hyperbolic",
    color: "#00D4FF",
    textIcon: "HY",
    notice: {
      apiKeyUrl: "https://app.hyperbolic.xyz/settings",
    },
    website: "https://hyperbolic.xyz",
  },
  inferhub: {
    alias: "inferhub",
    name: "InferHub",
    color: "#6366F1",
    textIcon: "IH",
    notice: {
      text: "OpenAI-compatible multi-provider hub. Models use prefixed ids (cb/, cc/, cmc/, …) plus short aliases.",
      apiKeyUrl: "https://inferhub.dev/dashboard/keys",
    },
    website: "https://inferhub.dev",
    modelsFetcher: {
      url: "https://api.inferhub.dev/v1/models",
      type: "openai",
    },
  },
  inworld: {
    alias: "inworld",
    name: "Inworld TTS",
    color: "#FF6B6B",
    textIcon: "IW",
    notice: {
      text: "Free tier: 40 minutes/month TTS. Paid: TTS-1.5 Mini $0.01/min ($15/1M chars), TTS-1.5 Max $0.025/min ($30/1M chars). 270+ voices, 15 languages.",
      apiKeyUrl: "https://platform.inworld.ai/api-keys",
    },
    website: "https://inworld.ai",
  },
  "jina-ai": {
    alias: "jina",
    name: "Jina AI",
    color: "#2563EB",
    textIcon: "JA",
    notice: {
      text: "10M free tokens on signup (non-commercial), no credit card required.",
      apiKeyUrl: "https://jina.ai/?sui=apikey",
    },
    website: "https://jina.ai",
  },
  "jina-reader": {
    alias: "jina-reader",
    name: "Jina Reader",
    color: "#000000",
    textIcon: "JR",
    notice: {
      apiKeyUrl: "https://jina.ai/?sui=apikey",
    },
    website: "https://jina.ai/reader",
  },
  linkup: {
    alias: "linkup",
    name: "Linkup",
    color: "#0EA5E9",
    textIcon: "LK",
    notice: {
      apiKeyUrl: "https://app.linkup.so/api-keys",
    },
    website: "https://linkup.so",
  },
  "local-device": {
    alias: "local-device",
    name: "Local Device",
    color: "#64748B",
    textIcon: "LD",
    noAuth: true,
  },
  mistral: {
    alias: "mistral",
    name: "Mistral",
    color: "#FF7000",
    textIcon: "MI",
    notice: {
      apiKeyUrl: "https://console.mistral.ai/api-keys",
    },
    website: "https://mistral.ai",
  },
  nanobanana: {
    alias: "nanobanana",
    name: "NanoBanana API",
    color: "#FFD700",
    textIcon: "🍌",
    notice: {
      text: "3rd-party proxy for Google Nano Banana (Gemini 2.5/3 Flash Image).",
      apiKeyUrl: "https://nanobananaapi.ai/dashboard",
    },
    website: "https://nanobananaapi.ai",
  },
  openai: {
    alias: "openai",
    name: "OpenAI",
    color: "#10A37F",
    textIcon: "OA",
    notice: {
      apiKeyUrl: "https://platform.openai.com/api-keys",
    },
    website: "https://platform.openai.com",
  },
  "opencode-go": {
    alias: "opencode-go",
    name: "OpenCode Go",
    color: "#E87040",
    textIcon: "OC",
    notice: {
      text: "OpenCode Go subscription: $5/mo (then  0/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
    website: "https://opencode.ai/auth",
  },
  opencode: {
    alias: "oc",
    name: "OpenCode Free",
    color: "#E87040",
    textIcon: "OC",
    modelsFetcher: {
      url: "https://opencode.ai/inference/v1/models",
      type: "opencode-free",
    },
    noAuth: true,
    optionalApiKey: true,
  },
  "perplexity-web": {
    alias: "perplexity-web",
    name: "Perplexity Web (Pro/Max)",
    color: "#20808D",
    textIcon: "PW",
    website: "https://www.perplexity.ai",
  },
  playht: {
    alias: "playht",
    name: "PlayHT",
    color: "#00B4D8",
    textIcon: "PH",
    notice: {
      apiKeyUrl: "https://play.ht/studio/api-access",
    },
    website: "https://play.ht",
  },
  qoder: {
    alias: "qd",
    name: "Qoder",
    color: "#EC4899",
    notice: {
      signupUrl: "https://qoder.com",
    },
    website: "https://qoder.com",
    authModes: ["oauth"],
  },
  recraft: {
    alias: "recraft",
    name: "Recraft",
    color: "#EC4899",
    textIcon: "RC",
    notice: {
      apiKeyUrl: "https://www.recraft.ai/profile/api",
    },
    website: "https://recraft.ai",
  },
  runwayml: {
    alias: "runwayml",
    name: "Runway ML",
    color: "#000000",
    textIcon: "RW",
    notice: {
      apiKeyUrl: "https://dev.runwayml.com",
    },
    website: "https://runwayml.com",
  },
  sdwebui: {
    alias: "sdwebui",
    name: "SD WebUI",
    color: "#FF7043",
    textIcon: "SD",
    website: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
  },
  searchapi: {
    alias: "searchapi",
    name: "SearchAPI",
    color: "#0EA5A4",
    textIcon: "SA",
    notice: {
      apiKeyUrl: "https://www.searchapi.io/dashboard",
    },
    website: "https://www.searchapi.io",
  },
  searxng: {
    alias: "searxng",
    name: "SearXNG",
    color: "#3B82F6",
    textIcon: "SX",
    website: "https://docs.searxng.org",
    noAuth: true,
  },
  serper: {
    alias: "serper",
    name: "Serper",
    color: "#4F46E5",
    textIcon: "SP",
    notice: {
      apiKeyUrl: "https://serper.dev/api-key",
    },
    website: "https://serper.dev",
  },
  "stability-ai": {
    alias: "stability-ai",
    name: "Stability AI",
    color: "#8B5CF6",
    textIcon: "SA",
    notice: {
      apiKeyUrl: "https://platform.stability.ai/account/keys",
    },
    website: "https://stability.ai",
  },
  tavily: {
    alias: "tavily",
    name: "Tavily",
    color: "#5B21B6",
    textIcon: "TV",
    notice: {
      apiKeyUrl: "https://app.tavily.com/home",
    },
    website: "https://tavily.com",
  },
  topaz: {
    alias: "topaz",
    name: "Topaz",
    color: "#059669",
    textIcon: "TP",
    notice: {
      apiKeyUrl: "https://topazlabs.com/account",
    },
    website: "https://topazlabs.com",
  },
  tortoise: {
    alias: "tortoise",
    name: "Tortoise TTS",
    color: "#7C3AED",
    textIcon: "TT",
    website: "https://github.com/neonbjb/tortoise-tts",
    noAuth: true,
  },
  "voyage-ai": {
    alias: "voyage-ai",
    name: "Voyage AI",
    color: "#0EA5E9",
    textIcon: "VG",
    notice: {
      apiKeyUrl: "https://dash.voyageai.com/api-keys",
    },
    website: "https://www.voyageai.com",
  },
  youcom: {
    alias: "youcom",
    name: "You.com Search",
    color: "#7C3AED",
    textIcon: "YC",
    notice: {
      apiKeyUrl: "https://api.you.com",
    },
    website: "https://you.com",
  },
  river: {
    alias: "river",
    name: "River AI",
    color: "#254F9F",
    textIcon: "RV",
    notice: {
      apiKeyUrl: "https://river.ai",
    },
    website: "https://river.ai",
    authModes: ["apikey"],
  },
  tokenharbor: {
    alias: "tokenharbor",
    name: "Token Harbor",
    color: "#0F766E",
    textIcon: "TH",
    notice: {
      apiKeyUrl: "https://tokenharbor.ai/dashboard",
    },
    website: "https://tokenharbor.ai",
    authModes: ["apikey"],
  },
  zenmux: {
    alias: "zenmux",
    name: "ZenMux",
    color: "#7C3AED",
    textIcon: "ZM",
    notice: {
      apiKeyUrl: "https://zenmux.ai",
    },
    website: "https://zenmux.ai",
    authModes: ["apikey"],
    modelsFetcher: {
      url: "https://zenmux.ai/api/v1/models",
      type: "openai",
    },
  },
  autoclaw: {
    alias: "autoclaw",
    name: "AutoClaw",
    color: "#0EA5E9",
    textIcon: "AC",
    notice: {
      text: "Paste your AutoClaw refresh token. LobakAI refreshes the session and routes requests to the AutoGLM / Z.ai backend directly.",
      signupUrl: "https://autoclaw.z.ai",
    },
    website: "https://autoclaw.z.ai",
    authModes: ["apikey"],
  },
};

export function providerMeta(providerId: string): ProviderMeta {
  return PROVIDER_META[providerId] || {};
}

// v1 getProviderAlias: custom models and aliases key off this storage alias.
export function getProviderAlias(providerId: string): string {
  return PROVIDER_META[providerId]?.alias || providerId;
}

export function resolveProviderId(aliasOrId: string): string {
  return (
    Object.entries(PROVIDER_META).find(
      ([, meta]) => meta.alias === aliasOrId,
    )?.[0] || aliasOrId
  );
}
