<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  CheckCircle2,
  LayoutGrid,
  List,
  LoaderCircle,
  Plus,
  Search,
  X,
  Zap,
} from "lucide-vue-next";
import { RouterLink } from "vue-router";
import { api } from "@/lib/api";
import type { ProviderConnection, ProviderNode } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";
import Select from "@/components/ui/select.vue";
import Card from "@/components/ui/card.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import TabSwitcher from "@/components/ui/tab-switcher.vue";
import { useNotificationStore } from "@/stores/notifications";
import ProviderLogo from "@/components/app/ProviderLogo.vue";
import Modal from "@/components/ui/modal.vue";

type CatalogEntry = {
  id: string;
  name: string;
  auth: "oauth" | "free" | "apikey";
  noAuth?: boolean;
};
const providerNames: Record<string, string> = {
  autoclaw: "AutoClaw",
  "alims-intl": "Alibaba Studio",
  anthropic: "Anthropic",
  antigravity: "Antigravity",
  assemblyai: "AssemblyAI",
  "aws-polly": "AWS Polly",
  "black-forest-labs": "Black Forest Labs",
  "brave-search": "Brave Search",
  cartesia: "Cartesia",
  claude: "Claude Code",
  "codebuddy-intl-cli": "CodeBuddy CLI",
  codex: "OpenAI Codex",
  comfyui: "ComfyUI",
  commandcode: "Command Code",
  coqui: "Coqui TTS",
  deepgram: "Deepgram",
  deepseek: "DeepSeek",
  "deepseek-harness": "DeepSeek Harness",
  "edge-tts": "Edge TTS",
  elevenlabs: "ElevenLabs",
  exa: "Exa",
  "experiential-labs": "Experiential Labs",
  "fal-ai": "Fal.ai",
  "glm-cn": "GLM (China)",
  glm: "GLM Coding",
  "gmi-cloud": "GMI Cloud",
  bitdeer: "BitDeer AI",
  "google-pse": "Google PSE",
  "google-tts": "Google TTS",
  "grok-cli": "Grok CLI (Grok Build)",
  "grok-web": "Grok Web (Subscription)",
  huggingface: "HuggingFace",
  hyperbolic: "Hyperbolic",
  inferhub: "InferHub",
  inworld: "Inworld TTS",
  "jina-ai": "Jina AI",
  "jina-reader": "Jina Reader",
  linkup: "Linkup",
  "local-device": "Local Device",
  mistral: "Mistral",
  nanobanana: "NanoBanana API",
  openai: "OpenAI",
  "opencode-go": "OpenCode Go",
  opencode: "OpenCode Free",
  "perplexity-web": "Perplexity Web (Pro/Max)",
  playht: "PlayHT",
  qoder: "Qoder",
  recraft: "Recraft",
  runwayml: "Runway ML",
  sdwebui: "SD WebUI",
  searchapi: "SearchAPI",
  searxng: "SearXNG",
  serper: "Serper",
  "stability-ai": "Stability AI",
  tavily: "Tavily",
  river: "River AI",
  tokenharbor: "Token Harbor",
  topaz: "Topaz",
  tortoise: "Tortoise TTS",
  "voyage-ai": "Voyage AI",
  youcom: "You.com",
  zenmux: "ZenMux",
};
const names = providerNames;
const ids = {
  oauth: [
    "autoclaw",
    "claude",
    "antigravity",
    "codex",
    "qoder",
    "codebuddy-intl-cli",
    "grok-cli",
    "deepseek-harness",
  ],
  free: ["opencode"],
  freeTier: [
    "coqui",
    "edge-tts",
    "google-tts",
    "local-device",
    "searxng",
    "tortoise",
  ],
  apikey: [
    "zenmux",
    "alims-intl",
    "deepgram",
    "anthropic",
    "assemblyai",
    "openai",
    "voyage-ai",
    "black-forest-labs",
    "stability-ai",
    "river",
    "tokenharbor",
    "experiential-labs",
    "huggingface",
    "recraft",
    "mistral",
    "nanobanana",
    "runwayml",
    "fal-ai",
    "commandcode",
    "deepseek",
    "sdwebui",
    "inferhub",
    "comfyui",
    "glm-cn",
    "glm",
    "gmi-cloud",
    "bitdeer",
    "opencode-go",
    "aws-polly",
    "brave-search",
    "cartesia",
    "elevenlabs",
    "exa",
    "firecrawl",
    "google-pse",
    "inworld",
    "jina-ai",
    "jina-reader",
    "linkup",
    "playht",
    "searchapi",
    "serper",
    "tavily",
    "topaz",
    "youcom",
  ],
  webCookie: ["grok-web", "perplexity-web"],
};
const NO_AUTH_IDS = new Set([
  "opencode",
  "tortoise",
  "searxng",
  "local-device",
  "edge-tts",
  "coqui",
  "google-tts",
]);
function entries(values: string[], auth: CatalogEntry["auth"]): CatalogEntry[] {
  return values.map((id) => ({
    id,
    name: names[id] || id,
    auth,
    noAuth: NO_AUTH_IDS.has(id),
  }));
}
const catalog: Record<string, CatalogEntry[]> = {
  "OAuth providers": entries(ids.oauth, "oauth"),
  "Free Tier Providers": [
    ...entries(ids.free, "free"),
    ...entries(ids.freeTier, "free"),
  ],
  "API key providers": entries(ids.apikey, "apikey"),
};

const queryClient = useQueryClient();
const notices = useNotificationStore();
const providers = useQuery({
  queryKey: ["providers"],
  queryFn: api.providers.list,
});
const nodes = useQuery({
  queryKey: ["provider-nodes"],
  queryFn: api.nodes.list,
});
const search = ref("");
type Capability =
  | "chat"
  | "images"
  | "tts"
  | "stt"
  | "embeddings"
  | "search"
  | "custom"
  | "all";
const capability = ref<Capability>("chat");
const capabilityOptions: { value: Capability; label: string }[] = [
  { value: "all", label: "All" },
  { value: "chat", label: "Chat" },
  { value: "images", label: "Images" },
  { value: "tts", label: "TTS" },
  { value: "stt", label: "STT" },
  { value: "embeddings", label: "Embeddings" },
  { value: "search", label: "Search" },
  { value: "custom", label: "Custom" },
];
// Mirrors backend registry `serviceKinds`. Providers without a declared kind
// (legacy chat providers, e.g. tokenharbor) count as chat.
const MEDIA_ONLY = new Set([
  "assemblyai",
  "aws-polly",
  "black-forest-labs",
  "brave-search",
  "cartesia",
  "comfyui",
  "coqui",
  "deepgram",
  "edge-tts",
  "elevenlabs",
  "exa",
  "fal-ai",
  "firecrawl",
  "google-pse",
  "google-tts",
  "huggingface",
  "inworld",
  "jina-ai",
  "jina-reader",
  "linkup",
  "local-device",
  "nanobanana",
  "playht",
  "recraft",
  "runwayml",
  "sdwebui",
  "searchapi",
  "searxng",
  "serper",
  "stability-ai",
  "tavily",
  "topaz",
  "tortoise",
  "voyage-ai",
  "youcom",
]);
const CAPABILITY_SETS: Record<
  Exclude<Capability, "chat" | "custom" | "all">,
  Set<string>
> = {
  images: new Set([
    "antigravity",
    "black-forest-labs",
    "codex",
    "comfyui",
    "fal-ai",
    "huggingface",
    "nanobanana",
    "openai",
    "recraft",
    "runwayml",
    "sdwebui",
    "stability-ai",
    "topaz",
  ]),
  tts: new Set([
    "aws-polly",
    "cartesia",
    "coqui",
    "edge-tts",
    "elevenlabs",
    "google-tts",
    "inworld",
    "local-device",
    "openai",
    "playht",
    "tortoise",
  ]),
  stt: new Set(["assemblyai", "deepgram", "huggingface", "openai"]),
  embeddings: new Set(["jina-ai", "mistral", "openai", "voyage-ai"]),
  search: new Set([
    "brave-search",
    "exa",
    "firecrawl",
    "google-pse",
    "jina-reader",
    "linkup",
    "openai",
    "searchapi",
    "searxng",
    "serper",
    "tavily",
    "youcom",
  ]),
};
function provides(id: string, cap: Capability): boolean {
  if (cap === "all") return true;
  if (cap === "custom") return false;
  if (cap === "chat") return !MEDIA_ONLY.has(id);
  return CAPABILITY_SETS[cap].has(id);
}
// Directory packs every provider into slim multi-column rows; cards keeps
// the roomier tiles.
type ListView = "directory" | "cards";
const VIEW_KEY = "lobakai-providers-view";
function readView(): ListView {
  try {
    return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "directory";
  } catch {
    return "directory";
  }
}
const view = ref<ListView>(readView());
watch(view, (value) => {
  try {
    localStorage.setItem(VIEW_KEY, value);
  } catch {
    /* storage unavailable; keep the in-memory choice */
  }
});
const viewOptions = [
  { value: "directory", label: "Directory view", icon: List },
  { value: "cards", label: "Card view", icon: LayoutGrid },
] as const;
const directory = computed(() => view.value === "directory");
const showCustomForm = ref(false);
const testing = ref<string | null>(null);
const results = ref<{ passed: number; failed: number; total: number } | null>(
  null,
);
const form = reactive({
  kind: "openai" as "openai" | "anthropic",
  id: "",
  name: "",
  prefix: "",
  baseUrl: "",
  apiKey: "",
  apiType: "chat",
});
// The ID follows the name until the user edits the ID field directly.
const idEdited = ref(false);
function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64)
    .replace(/[-_]+$/, "");
}
watch(
  () => form.name,
  (name) => {
    if (!idEdited.value) form.id = slugify(name);
  },
);
function onIdInput(event: Event) {
  idEdited.value = true;
  const input = event.target as HTMLInputElement;
  form.id = input.value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  // Keep the field in step when sanitizing leaves the model value unchanged.
  if (input.value !== form.id) input.value = form.id;
}
// Mirrors backend NODE_ID_PATTERN; the backend also rejects built-in aliases.
const NODE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const builtInIds = new Set(["new", ...Object.values(ids).flat()]);
const idError = computed(() => {
  const id = form.id.trim();
  if (!id) return "";
  if (!NODE_ID_PATTERN.test(id))
    return "Use lowercase letters, digits, '-' or '_'. Start and end with a letter or digit.";
  if (builtInIds.has(id)) return "A built-in provider uses this ID.";
  if ((nodes.data.value || []).some((node) => node.id === id))
    return "Another custom provider uses this ID.";
  return "";
});
const kindOptions = [
  { value: "openai", label: "OpenAI compatible" },
  { value: "anthropic", label: "Anthropic compatible" },
] as const;
const apiTypeOptions = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
];

const visibleProviders = computed(() => providers.data.value || []);
function matches(name: string) {
  return (
    !search.value.trim() ||
    name.toLowerCase().includes(search.value.trim().toLowerCase())
  );
}
function connectionsFor(id: string) {
  return visibleProviders.value.filter((p) => p.provider === id);
}
function status(id: string) {
  const rows = connectionsFor(id);
  const good = rows.filter((p) => p.isActive && !lastError(p)).length;
  const bad = rows.filter((p) => Boolean(lastError(p))).length;
  return {
    total: rows.length,
    good,
    bad,
    disabled: rows.length > 0 && rows.every((p) => !p.isActive),
  };
}
function lastError(provider: ProviderConnection) {
  return String(provider.data?.lastError || "");
}
function entryRows(section: string) {
  const rows = catalog[section].filter(
    (entry) => provides(entry.id, capability.value) && matches(entry.name),
  );
  rows.sort((a, b) => {
    const na = a.noAuth ? 0 : 1;
    const nb = b.noAuth ? 0 : 1;
    if (na !== nb) return na - nb;
    const ca = status(a.id).total > 0 ? 0 : 1;
    const cb = status(b.id).total > 0 ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });
  return rows;
}
async function toggle(entry: CatalogEntry) {
  const rows = connectionsFor(entry.id);
  if (!rows.length) return;
  const active = rows.some((row) => row.isActive);
  await Promise.all(
    rows.map((row) => api.providers.update(row.id, { isActive: !active })),
  );
  await queryClient.invalidateQueries({ queryKey: ["providers"] });
}
async function test(id: string) {
  testing.value = id;
  try {
    const result = await api.providers.test(id);
    notices.push(
      result.ok ? "success" : "error",
      result.ok
        ? "Provider test passed."
        : result.error || "Provider test failed.",
    );
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Provider test failed",
    );
  } finally {
    testing.value = null;
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
  }
}
async function batchTest(section: string) {
  const ids = [
    ...new Set(
      catalog[section].flatMap((entry) =>
        connectionsFor(entry.id).map((p) => p.id),
      ),
    ),
  ];
  if (!ids.length) {
    notices.push("info", "No connections in this provider group.");
    return;
  }
  testing.value = section;
  let passed = 0;
  await Promise.all(
    ids.map(async (id) => {
      try {
        if ((await api.providers.test(id)).ok) passed++;
      } catch {
        /* counted as failed */
      }
    }),
  );
  results.value = { total: ids.length, passed, failed: ids.length - passed };
  testing.value = null;
  await queryClient.invalidateQueries({ queryKey: ["providers"] });
}
const createNode = useMutation({
  mutationFn: () =>
    api.nodes.create({
      id: form.id.trim(),
      name: form.name.trim(),
      prefix: form.prefix.trim(),
      baseUrl: form.baseUrl.trim(),
      type:
        form.kind === "anthropic"
          ? "anthropic-compatible"
          : "openai-compatible",
      ...(form.kind === "openai" ? { apiType: form.apiType } : {}),
      data: form.apiKey ? { apiKey: form.apiKey } : {},
    }),
  onSuccess: () => {
    notices.push("success", "Custom provider added.");
    queryClient.invalidateQueries({ queryKey: ["provider-nodes"] });
    showCustomForm.value = false;
    idEdited.value = false;
    Object.assign(form, {
      kind: "openai",
      id: "",
      name: "",
      prefix: "",
      baseUrl: "",
      apiKey: "",
      apiType: "chat",
    });
  },
  onError: (error) => notices.push("error", error.message),
});
async function checkNode() {
  try {
    const response = await api.nodes.validate(form.baseUrl.trim());
    notices.push(
      response.ok ? "success" : "error",
      response.ok
        ? "Endpoint is reachable."
        : response.error || "Endpoint check failed",
    );
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Endpoint check failed",
    );
  }
}
function nodeName(node: ProviderNode) {
  return node.name || node.prefix || "Compatible provider";
}
const customRows = computed(() =>
  [...(nodes.data.value || [])]
    .filter((node) => matches(nodeName(node)))
    .sort((a, b) => nodeName(a).localeCompare(nodeName(b))),
);
const showCustom = computed(
  () => capability.value === "custom" || capability.value === "all",
);

const CUSTOM_SECTION_ID = "providers-custom";
function sectionId(section: string) {
  return `providers-${section.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
const navItems = computed(() => {
  const items: { id: string; label: string; count: number }[] = [];
  if (
    showCustom.value &&
    (customRows.value.length || capability.value === "custom")
  ) {
    items.push({
      id: CUSTOM_SECTION_ID,
      label: "Custom providers",
      count: customRows.value.length,
    });
  }
  for (const section of Object.keys(catalog)) {
    const count = entryRows(section).length;
    if (count) items.push({ id: sectionId(section), label: section, count });
  }
  return items;
});

// Highlight the topmost category that is inside the upper part of the viewport.
const activeSection = ref<string | null>(null);
const visibleSections = new Set<string>();
const sectionObserver =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(
        (records) => {
          for (const record of records) {
            if (record.isIntersecting) visibleSections.add(record.target.id);
            else visibleSections.delete(record.target.id);
          }
          const first = navItems.value.find((item) =>
            visibleSections.has(item.id),
          );
          if (first) activeSection.value = first.id;
        },
        { rootMargin: "0px 0px -60% 0px" },
      );
function observeSection(el: unknown) {
  if (el instanceof Element) sectionObserver?.observe(el);
}
watch(
  navItems,
  (items) => {
    if (!items.some((item) => item.id === activeSection.value)) {
      activeSection.value = items[0]?.id ?? null;
    }
  },
  { immediate: true },
);
function scrollToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  activeSection.value = id;
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}
onBeforeUnmount(() => sectionObserver?.disconnect());
</script>

<template>
  <div class="theme-v2 space-y-6">
    <PageHeader
      title="Providers"
      description="Connect and manage the upstream providers available to the router."
    >
      <template #actions
        ><Button @click="showCustomForm = true"
          ><Plus class="size-4" />Add custom provider</Button
        ></template
      >
    </PageHeader>
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative w-full sm:w-72">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        /><Input
          v-model="search"
          class="pl-9"
          placeholder="Search providers..."
          aria-label="Search providers"
        />
      </div>
      <div class="max-w-full overflow-x-auto">
        <TabSwitcher v-model="capability" :options="capabilityOptions" />
      </div>
      <div class="flex items-center gap-3 lg:ml-auto">
        <span class="text-xs text-muted-foreground"
          >{{ visibleProviders.length }} configured connection{{
            visibleProviders.length === 1 ? "" : "s"
          }}</span
        >
        <div
          role="group"
          aria-label="List view"
          class="inline-flex h-9 items-center rounded-md bg-muted p-1"
        >
          <button
            v-for="option in viewOptions"
            :key="option.value"
            type="button"
            class="grid h-7 w-8 place-items-center rounded-[5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="
              view === option.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            "
            :aria-pressed="view === option.value"
            :aria-label="option.label"
            :title="option.label"
            @click="view = option.value"
          >
            <component :is="option.icon" class="size-4" />
          </button>
        </div>
      </div>
    </div>

    <div
      class="grid gap-8"
      :class="{ 'lg:grid-cols-[minmax(0,1fr)_11rem]': navItems.length }"
    >
      <div
        :key="capability"
        class="animate-in fade-in slide-in-from-bottom-1 space-y-6 duration-200 motion-reduce:animate-none"
      >
        <p
          v-if="directory"
          class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <span class="inline-flex items-center gap-1.5"
            ><span class="size-1.5 rounded-full bg-success" />Connected</span
          ><span class="inline-flex items-center gap-1.5"
            ><X class="size-2.5 text-destructive" />Error</span
          ><span class="inline-flex items-center gap-1.5"
            ><span
              class="size-1.5 rounded-full border border-current"
            />Disabled</span
          ><span class="inline-flex items-center gap-1.5"
            ><span>–</span>No connections</span
          >
        </p>
        <section
          v-if="showCustom && (customRows.length || capability === 'custom')"
          :id="CUSTOM_SECTION_ID"
          :ref="observeSection"
          class="scroll-mt-6"
          :class="directory ? 'space-y-2' : 'space-y-3'"
        >
          <div class="flex min-h-8 items-center justify-between gap-2">
            <h2
              class="flex items-baseline gap-2 font-semibold"
              :class="directory ? 'text-base' : 'text-lg'"
            >
              Custom providers<span
                v-if="customRows.length"
                class="text-xs font-normal tabular-nums text-muted-foreground"
                >{{ customRows.length }}</span
              >
            </h2>
          </div>
          <ul
            v-if="customRows.length && directory"
            class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
          >
            <li v-for="node in customRows" :key="node.id">
              <RouterLink
                :to="`/dashboard/providers/${node.id}`"
                :title="node.baseUrl || node.base_url || undefined"
                class="flex h-11 items-center gap-2.5 rounded-lg border bg-card px-3 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                ><span class="min-w-0 flex-1 truncate text-sm font-medium">{{
                  nodeName(node)
                }}</span
                ><span class="shrink-0 text-xs text-muted-foreground">{{
                  node.type === "anthropic-compatible" ? "Anthropic" : "OpenAI"
                }}</span></RouterLink
              >
            </li>
          </ul>
          <div
            v-else-if="customRows.length"
            class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            <RouterLink
              v-for="node in customRows"
              :key="node.id"
              :to="`/dashboard/providers/${node.id}`"
              class="rounded-[10px] border bg-card p-[15px] transition-colors hover:border-primary"
              ><div class="flex items-start justify-between gap-2">
                <p class="truncate font-medium">{{ nodeName(node) }}</p>
                <Badge class="shrink-0 rounded-[5px]" variant="secondary">{{
                  node.type === "anthropic-compatible" ? "Anthropic" : "OpenAI"
                }}</Badge>
              </div>
              <p class="mt-1 truncate text-xs text-muted-foreground">
                {{ node.baseUrl || node.base_url }}
              </p></RouterLink
            >
          </div>
          <div
            v-else
            class="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          >
            <p v-if="search.trim()">No custom provider matches your search.</p>
            <p v-else>
              No custom providers yet. Add an OpenAI or Anthropic compatible
              endpoint to route requests to it.
            </p>
            <Button
              v-if="!search.trim()"
              size="sm"
              variant="outline"
              @click="showCustomForm = true"
              ><Plus class="size-4" />Add custom provider</Button
            >
          </div>
        </section>

        <section
          v-for="section in Object.keys(catalog)"
          :key="section"
          v-show="entryRows(section).length"
          :id="sectionId(section)"
          :ref="observeSection"
          class="scroll-mt-6"
          :class="directory ? 'space-y-2' : 'space-y-3'"
        >
          <div class="flex items-center justify-between gap-2">
            <h2
              class="flex items-baseline gap-2 font-semibold"
              :class="directory ? 'text-base' : 'text-lg'"
            >
              {{ section
              }}<span
                class="text-xs font-normal tabular-nums text-muted-foreground"
                >{{ entryRows(section).length }}</span
              >
            </h2>
            <Button
              variant="outline"
              size="sm"
              :disabled="testing === section"
              @click="batchTest(section)"
              ><LoaderCircle
                v-if="testing === section"
                class="size-4 animate-spin"
              /><Zap v-else class="size-4" />{{
                testing === section ? "Testing..." : "Test all"
              }}</Button
            >
          </div>
          <ul
            v-if="directory"
            class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
          >
            <li v-for="entry in entryRows(section)" :key="entry.id">
              <RouterLink
                :to="`/dashboard/providers/${entry.id}`"
                class="group flex h-11 items-center gap-2.5 rounded-lg border bg-card px-3 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="{ 'opacity-55': status(entry.id).disabled }"
                ><ProviderLogo
                  :provider="entry.id"
                  :label="entry.name"
                  size="size-6"
                /><span class="min-w-0 flex-1 truncate text-sm font-medium">{{
                  entry.name
                }}</span
                ><button
                  v-if="status(entry.id).total"
                  type="button"
                  class="hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent group-focus-within:grid group-hover:grid"
                  :title="
                    status(entry.id).disabled
                      ? 'Enable provider'
                      : 'Disable provider'
                  "
                  :aria-label="
                    status(entry.id).disabled
                      ? `Enable ${entry.name}`
                      : `Disable ${entry.name}`
                  "
                  @click.prevent.stop="toggle(entry)"
                >
                  <CheckCircle2
                    class="size-4"
                    :class="
                      status(entry.id).disabled
                        ? 'text-muted-foreground'
                        : 'text-success'
                    "
                  /></button
                ><span
                  class="flex shrink-0 items-center gap-2 text-xs tabular-nums"
                  ><Skeleton
                    v-if="providers.isPending.value"
                    class="h-3 w-6"
                  /><span
                    v-else-if="status(entry.id).disabled"
                    class="inline-flex items-center gap-1 text-muted-foreground"
                    title="Disabled"
                    ><span
                      class="size-1.5 rounded-full border border-current"
                      aria-hidden="true"
                    /><span class="sr-only">Disabled</span></span
                  ><template v-else-if="status(entry.id).total"
                    ><span
                      v-if="status(entry.id).good"
                      class="inline-flex items-center gap-1 text-success"
                      :title="`${status(entry.id).good} connected`"
                      ><span
                        class="size-1.5 rounded-full bg-success"
                        aria-hidden="true"
                      />{{ status(entry.id).good
                      }}<span class="sr-only"> connected</span></span
                    ><span
                      v-if="status(entry.id).bad"
                      class="inline-flex items-center gap-0.5 text-destructive"
                      :title="`${status(entry.id).bad} error`"
                      ><X class="size-2.5" aria-hidden="true" />{{
                        status(entry.id).bad
                      }}<span class="sr-only"> error</span></span
                    ></template
                  ><span
                    v-else
                    class="text-muted-foreground"
                    title="No connections"
                    ><span aria-hidden="true">–</span
                    ><span class="sr-only">No connections</span></span
                  ></span
                ></RouterLink
              >
            </li>
          </ul>
          <div
            v-else
            class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            <RouterLink
              v-for="entry in entryRows(section)"
              :key="entry.id"
              :to="`/dashboard/providers/${entry.id}`"
              class="group rounded-[10px] border bg-card p-[15px] transition-colors hover:border-primary"
              :class="{ 'opacity-55': status(entry.id).disabled }"
              ><div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 items-center gap-3">
                  <ProviderLogo :provider="entry.id" :label="entry.name" />
                  <div class="min-w-0">
                    <p class="truncate font-medium">{{ entry.name }}</p>
                    <div
                      class="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
                    >
                      <Badge
                        v-if="status(entry.id).disabled"
                        variant="secondary"
                        class="rounded-[5px]"
                        >Disabled</Badge
                      ><template v-else
                        ><Badge
                          v-if="status(entry.id).good"
                          variant="success"
                          class="rounded-[5px]"
                          >{{ status(entry.id).good }} connected</Badge
                        ><Badge
                          v-if="status(entry.id).bad"
                          variant="destructive"
                          class="rounded-[5px]"
                          >{{ status(entry.id).bad }} error</Badge
                        ><Skeleton
                          v-if="providers.isPending.value"
                          class="h-4 w-20"
                        /><span
                          v-else-if="!status(entry.id).total"
                          class="text-muted-foreground"
                          >No connections</span
                        ></template
                      >
                    </div>
                  </div>
                </div>
                <button
                  v-if="status(entry.id).total"
                  type="button"
                  class="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100"
                  :title="
                    status(entry.id).disabled
                      ? 'Enable provider'
                      : 'Disable provider'
                  "
                  :aria-label="
                    status(entry.id).disabled
                      ? `Enable ${entry.name}`
                      : `Disable ${entry.name}`
                  "
                  @click.prevent.stop="toggle(entry)"
                >
                  <CheckCircle2
                    class="size-4"
                    :class="
                      status(entry.id).disabled
                        ? 'text-muted-foreground'
                        : 'text-success'
                    "
                  />
                </button></div
            ></RouterLink>
          </div>
        </section>
      </div>
      <nav
        v-if="navItems.length"
        aria-label="Provider categories"
        class="hidden lg:block"
      >
        <div class="sticky top-6 space-y-1 border-l pl-3">
          <p
            class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            On this page
          </p>
          <a
            v-for="item in navItems"
            :key="item.id"
            :href="`#${item.id}`"
            class="-ml-[13px] flex items-center justify-between gap-2 border-l-2 py-1 pl-3 text-sm transition-colors"
            :class="
              activeSection === item.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            "
            :aria-current="activeSection === item.id ? 'location' : undefined"
            @click.prevent="scrollToSection(item.id)"
            ><span class="truncate">{{ item.label }}</span
            ><span class="text-xs tabular-nums text-muted-foreground">{{
              item.count
            }}</span></a
          >
        </div>
      </nav>
    </div>
    <EmptyState
      v-if="
        !providers.isPending.value &&
        capability !== 'custom' &&
        !Object.keys(catalog).some((section) => entryRows(section).length) &&
        !(showCustom && customRows.length)
      "
      title="No providers match your search"
      description="Try another provider name, or switch the filter to All."
    />

    <Modal
      :open="showCustomForm"
      title="Add custom provider"
      size="lg"
      @close="showCustomForm = false"
      ><p class="mb-5 text-xs text-muted-foreground">
        Connect your own endpoint. Check it before you save.
      </p>
      <form class="space-y-4" @submit.prevent="createNode.mutate()">
        <div class="space-y-2">
          <p id="custom-kind-label" class="text-sm font-medium">
            Compatibility
          </p>
          <TabSwitcher
            v-model="form.kind"
            :options="kindOptions"
            aria-labelledby="custom-kind-label"
            class="w-full"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-2">
            <Label for="compatible-name">Name</Label
            ><Input
              id="compatible-name"
              v-model="form.name"
              placeholder="Production endpoint"
              required
            />
          </div>
          <div class="space-y-2">
            <Label for="compatible-id">ID</Label
            ><Input
              id="compatible-id"
              v-model="form.id"
              placeholder="provider-hakim"
              autocomplete="off"
              spellcheck="false"
              maxlength="64"
              required
              :aria-invalid="Boolean(idError)"
              aria-describedby="compatible-id-hint"
              @input="onIdInput"
            />
            <p
              id="compatible-id-hint"
              class="text-xs"
              :class="idError ? 'text-destructive' : 'text-muted-foreground'"
            >
              {{
                idError ||
                "Permanent. Used in the provider URL and logs. You cannot change it later."
              }}
            </p>
          </div>
          <div class="space-y-2 sm:col-span-2">
            <Label for="compatible-prefix">Prefix</Label
            ><Input
              id="compatible-prefix"
              v-model="form.prefix"
              placeholder="my-provider"
              required
            />
          </div>
        </div>
        <div class="space-y-2">
          <Label for="compatible-url">Base URL</Label
          ><Input
            id="compatible-url"
            v-model="form.baseUrl"
            type="url"
            :placeholder="
              form.kind === 'openai'
                ? 'https://api.openai.com/v1'
                : 'https://api.anthropic.com/v1'
            "
            required
          />
        </div>
        <div v-if="form.kind === 'openai'" class="space-y-2">
          <Label for="compatible-type">API type</Label
          ><Select
            id="compatible-type"
            v-model="form.apiType"
            :options="apiTypeOptions"
          />
        </div>
        <div class="space-y-2">
          <Label for="compatible-key">API key</Label
          ><Input
            id="compatible-key"
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            placeholder="Optional check credential"
          />
        </div>
        <div class="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            :disabled="!form.baseUrl"
            @click="checkNode"
            >Check</Button
          ><Button
            type="submit"
            :disabled="
              createNode.isPending.value || !form.id.trim() || Boolean(idError)
            "
            >{{ createNode.isPending.value ? "Creating..." : "Create" }}</Button
          >
        </div>
      </form></Modal
    >
    <div
      v-if="results"
      class="fixed inset-0 z-30 grid place-items-center bg-black/35 p-4"
      @click.self="results = null"
    >
      <Card class="w-full max-w-md p-5"
        ><div class="flex items-center justify-between">
          <h2 class="font-semibold">Provider test results</h2>
          <button @click="results = null"><X class="size-5" /></button>
        </div>
        <div class="mt-5 flex items-center justify-around text-center">
          <div>
            <p class="text-2xl font-semibold text-success">
              {{ results.passed }}
            </p>
            <p class="text-xs text-muted-foreground">passed</p>
          </div>
          <div>
            <p class="text-2xl font-semibold text-destructive">
              {{ results.failed }}
            </p>
            <p class="text-xs text-muted-foreground">failed</p>
          </div>
          <div>
            <p class="text-2xl font-semibold">{{ results.total }}</p>
            <p class="text-xs text-muted-foreground">tested</p>
          </div>
        </div></Card
      >
    </div>
  </div>
</template>
