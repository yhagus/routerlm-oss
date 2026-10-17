export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  endpoint?: string;
  icon:
    | "hub"
    | "chat"
    | "image"
    | "record_voice_over"
    | "mic"
    | "data_array"
    | "search"
    | "web";
  isEntry?: boolean;
}

// Skill files ship in frontend/public/skills, so each instance serves its own.
function skillsBase() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/skills`;
}

export const SKILLS: SkillDefinition[] = [
  {
    id: "lobakai",
    name: "LobakAI (Entry)",
    description:
      "Setup and index of all capabilities. Start here for base URL, auth, model discovery, and capability links.",
    icon: "hub",
    isEntry: true,
  },
  {
    id: "lobakai-chat",
    name: "Chat",
    description:
      "Chat and code generation through OpenAI or Anthropic format with streaming.",
    endpoint: "/v1/chat/completions",
    icon: "chat",
  },
  {
    id: "lobakai-image",
    name: "Image Generation",
    description: "Text-to-image through configured image providers.",
    endpoint: "/v1/images/generations",
    icon: "image",
  },
  {
    id: "lobakai-tts",
    name: "Text-to-Speech",
    description:
      "OpenAI-compatible speech synthesis through configured voice providers.",
    endpoint: "/v1/audio/speech",
    icon: "record_voice_over",
  },
  {
    id: "lobakai-stt",
    name: "Speech-to-Text",
    description: "Audio transcription through configured speech providers.",
    endpoint: "/v1/audio/transcriptions",
    icon: "mic",
  },
  {
    id: "lobakai-embeddings",
    name: "Embeddings",
    description: "Vector generation for RAG and semantic search.",
    endpoint: "/v1/embeddings",
    icon: "data_array",
  },
  {
    id: "lobakai-web-search",
    name: "Web Search",
    description: "Search through the gateway's configured web search route.",
    endpoint: "/v1/search",
    icon: "search",
  },
  {
    id: "lobakai-web-fetch",
    name: "Web Fetch",
    description: "Fetch a URL as markdown, text, or HTML through the gateway.",
    endpoint: "/v1/web/fetch",
    icon: "web",
  },
];

export function skillRawUrl(id: string) {
  return `${skillsBase()}/${id}/SKILL.md`;
}
