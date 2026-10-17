<script setup lang="ts">
import {
  computed,
  onActivated,
  onDeactivated,
  nextTick,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { useQuery } from "@tanstack/vue-query";
import { Brain, MessageSquare, Plus, RefreshCw, Wrench } from "lucide-vue-next";
import { api } from "@/lib/api";
import { readGatewayStream } from "@/lib/stream";
import { extractDelta } from "@/lib/curl";
import type { ChatMessage, ChatToolCall } from "@/types/chat";
import EmptyState from "@/components/app/EmptyState.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import Button from "@/components/ui/button.vue";
import Card from "@/components/ui/card.vue";
import Combobox from "@/components/ui/combobox.vue";
import ModelSelect from "@/components/chat/ModelSelect.vue";
import Select from "@/components/ui/select.vue";
import ChatMessageList from "@/components/chat/ChatMessageList.vue";
import ChatComposer from "@/components/chat/ChatComposer.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";

type ChatFormat = "responses" | "messages";
type ChatMode = "standard" | "thinking" | "tools";
type ToolCall = { id: string; name: string; arguments: string };
type ToolResult = { call: ToolCall; result: unknown; isError: boolean };

const STORAGE_KEY = "lobakai.v2.chat.workspace";
const MAX_TOOL_ROUNDS = 6;
const AGENT_INSTRUCTIONS =
  "You operate as a local coding agent. Use a sandbox tool for sandbox file operations.";

const suggestions: Array<{ title: string; prompt: string; mode: ChatMode }> = [
  {
    title: "Explain request routing",
    prompt:
      "Explain how an AI gateway routes one request across providers, accounts, and fallbacks. Keep it short.",
    mode: "standard",
  },
  {
    title: "Review a code snippet",
    prompt:
      "Review this code. Name the riskiest assumption and the smallest useful fix.\n\n```\n\n```",
    mode: "standard",
  },
  {
    title: "Reason through a trade-off",
    prompt:
      "Compare retrying a failed upstream request on the same account versus switching accounts. Recommend one.",
    mode: "thinking",
  },
  {
    title: "Inspect the sandbox",
    prompt:
      "Inspect the local agent sandbox, list its files, and summarize what you find.",
    mode: "tools",
  },
];

const tools = {
  tool: {
    name: "sandbox_probe",
    description: "Inspect the local agent sandbox.",
    parameters: {
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"],
      additionalProperties: false,
    },
  },
  skill: {
    name: "load_skill",
    description: "Load a local agent skill.",
    parameters: {
      type: "object",
      properties: { skill_name: { type: "string" } },
      required: ["skill_name"],
      additionalProperties: false,
    },
  },
  mcp: {
    name: "mcp__sandbox__list_files",
    description: "List files through the sandbox MCP server.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  read: {
    name: "sandbox_read_file",
    description: "Read a UTF-8 text file from the local agent sandbox.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  write: {
    name: "sandbox_write_file",
    description:
      "Create or replace a UTF-8 text file in the local agent sandbox.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
} as const;

const formatOptions = [
  { value: "responses", label: "Responses API" },
  { value: "messages", label: "Messages API" },
];
const modeOptions = [
  { value: "standard", label: "Standard" },
  { value: "thinking", label: "Thinking" },
  { value: "tools", label: "Sandbox tools" },
];

type SavedWorkspace = {
  model?: string;
  format?: ChatFormat;
  mode?: ChatMode;
  messages?: ChatMessage[];
};

function loadWorkspace(): SavedWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedWorkspace) : {};
  } catch {
    return {};
  }
}

const saved = loadWorkspace();
const models = useQuery({
  queryKey: ["dashboard-chat-models"],
  queryFn: api.dashboardChat.models,
});
const selectedModel = ref(saved.model || "");
const selectedAccount = ref("");
const format = ref<ChatFormat>(
  saved.format === "messages" ? "messages" : "responses",
);
const mode = ref<ChatMode>(saved.mode || "standard");
// A reload interrupts any stream, so a saved streaming reply counts as done.
const messages = ref<ChatMessage[]>(
  (saved.messages || []).map((message) =>
    message.status === "streaming" ? { ...message, status: "done" } : message,
  ),
);
const draft = ref("");
const loading = ref(false);
const activity = ref("Thinking...");
const abortController = ref<AbortController | null>(null);
const clearConfirmOpen = ref(false);
const composer = ref<InstanceType<typeof ChatComposer> | null>(null);

const availableModels = computed(() => models.data.value?.data || []);
const activeModel = computed(() => {
  const ids = availableModels.value.map((model) => model.id);
  if (selectedModel.value && ids.includes(selectedModel.value))
    return selectedModel.value;
  return ids[0] || "";
});
const accounts = useQuery({
  queryKey: ["dashboard-chat-accounts", activeModel],
  queryFn: () => api.dashboardChat.accounts(activeModel.value),
  enabled: computed(() => Boolean(activeModel.value)),
});
const accountOptions = computed(() => accounts.data.value?.accounts || []);
const accountSupported = computed(
  () => accounts.data.value?.supportsSelection === true,
);
const accountSelectOptions = computed(() => [
  {
    value: "",
    label: accounts.isFetching.value
      ? "Loading accounts..."
      : accountSupported.value
        ? "Any account (fallback)"
        : "Combo account rules",
  },
  ...accountOptions.value.map((account) => ({
    value: account.id,
    label: `${account.label}${account.email ? ` · ${account.email}` : ""}`,
  })),
]);
const modelLabel = computed(() => activeModel.value || "No model selected");
const lastMessage = computed(() => messages.value[messages.value.length - 1]);
const canRegenerate = computed(
  () => lastMessage.value?.role === "assistant" && !loading.value,
);

watch(activeModel, (model) => {
  selectedAccount.value = "";
  // Show the fallback model in the picker instead of an empty search box.
  if (model && selectedModel.value !== model) selectedModel.value = model;
  // The composer is disabled until a model exists, so focus it only then, and
  // only when nothing else on the page holds focus.
  if (model && document.activeElement === document.body)
    void nextTick(() => composer.value?.focus());
}, { immediate: true });

watch(
  [selectedModel, format, mode, messages],
  () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          model: selectedModel.value,
          format: format.value,
          mode: mode.value,
          messages: messages.value,
        }),
      );
    } catch {
      // Storage can be full or blocked; the chat still works in memory.
    }
  },
  { deep: true },
);

function useSuggestion(prompt: string, nextMode: ChatMode) {
  draft.value = prompt;
  mode.value = nextMode;
  composer.value?.focus();
}

function newChat() {
  clearConfirmOpen.value = false;
  abortController.value?.abort();
  abortController.value = null;
  messages.value = [];
  draft.value = "";
  loading.value = false;
  composer.value?.focus();
}

function updateAssistant(id: string, patch: Partial<ChatMessage>) {
  messages.value = messages.value.map((message) =>
    message.id === id ? { ...message, ...patch } : message,
  );
}

function toolOptions() {
  if (mode.value === "thinking")
    return format.value === "messages"
      ? { thinking: { type: "enabled", budget_tokens: 4096 } }
      : { reasoning: { effort: "high", summary: "concise" } };
  if (mode.value !== "tools") return {};
  const selected = Object.values(tools);
  const definitions =
    format.value === "messages"
      ? selected.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        }))
      : selected.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }));
  return {
    tools: definitions,
    tool_choice: format.value === "messages" ? { type: "auto" } : "auto",
  };
}

function collectToolCall(
  payload: Record<string, unknown>,
  calls: Map<string, ToolCall>,
) {
  const delta =
    payload.delta && typeof payload.delta === "object"
      ? (payload.delta as Record<string, unknown>)
      : {};
  const item =
    payload.item && typeof payload.item === "object"
      ? (payload.item as Record<string, unknown>)
      : payload.content_block && typeof payload.content_block === "object"
        ? (payload.content_block as Record<string, unknown>)
        : {};
  const save = (key: string, id: string, name: string, argumentsText = "") => {
    const call = calls.get(key) || { id: id || key, name: "", arguments: "" };
    if (id) call.id = id;
    if (name) call.name = name;
    if (argumentsText) call.arguments += argumentsText;
    calls.set(key, call);
  };
  for (const value of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
    const entry =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const fn =
      entry.function && typeof entry.function === "object"
        ? (entry.function as Record<string, unknown>)
        : {};
    const key = String(entry.id || `index:${entry.index || 0}`);
    save(
      key,
      String(entry.id || key),
      String(fn.name || ""),
      String(fn.arguments || ""),
    );
  }
  const itemType = String(item.type || "").toLowerCase();
  if (itemType === "function_call" || itemType === "tool_use") {
    const key = String(item.call_id || item.id || "tool-call");
    const input =
      typeof item.arguments === "string"
        ? item.arguments
        : item.input && typeof item.input === "object"
          ? JSON.stringify(item.input)
          : "";
    save(
      key,
      String(item.call_id || item.id || key),
      String(item.name || ""),
      input,
    );
  }
}

async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
): Promise<ToolResult> {
  const response = await fetch("/api/dashboard/chat/tools", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name: call.name,
      arguments: call.arguments || "{}",
    }),
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  };
  return response.ok && payload.ok
    ? { call, result: payload.result, isError: false }
    : {
        call,
        result: payload.error || `Tool execution failed (${response.status})`,
        isError: true,
      };
}

function buildToolHistory(
  calls: ToolCall[],
  results: ToolResult[],
): Record<string, unknown>[] {
  const parse = (value: string) => {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return { input: value };
    }
  };
  if (format.value === "messages")
    return [
      {
        role: "assistant",
        content: calls.map((call) => ({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: parse(call.arguments),
        })),
      },
      {
        role: "user",
        content: results.map(({ call, result, isError }) => ({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result),
          ...(isError ? { is_error: true } : {}),
        })),
      },
    ];
  return [
    ...calls.map((call) => ({
      type: "function_call",
      call_id: call.id,
      name: call.name,
      arguments: call.arguments || "{}",
    })),
    ...results.map(({ call, result, isError }) => ({
      type: "function_call_output",
      call_id: call.id,
      output: JSON.stringify(
        isError ? { is_error: true, content: result } : result,
      ),
    })),
  ];
}

function requestBody(
  conversation: Array<{ role: ChatMessage["role"]; content: string }>,
  history: Record<string, unknown>[],
  options: Record<string, unknown>,
) {
  const hasTools = "tools" in options;
  if (format.value === "messages")
    return {
      model: activeModel.value,
      max_tokens: 8192,
      messages: [...conversation, ...history],
      stream: true,
      ...(hasTools ? { system: AGENT_INSTRUCTIONS } : {}),
      ...options,
    };
  return {
    model: activeModel.value,
    max_output_tokens: 8192,
    input: [
      ...conversation.map((message) => ({
        type: "message",
        role: message.role,
        content: [
          {
            type: message.role === "assistant" ? "output_text" : "input_text",
            text: message.content,
          },
        ],
      })),
      ...history,
    ],
    stream: true,
    ...(hasTools ? { instructions: AGENT_INSTRUCTIONS } : {}),
    ...options,
  };
}

async function runAssistant() {
  // Failed and empty replies carry no context, so the model never sees them.
  const conversation = messages.value
    .filter((message) => message.status !== "error" && message.content.trim())
    .map(({ role, content }) => ({ role, content }));
  const assistant: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    status: "streaming",
    model: activeModel.value,
    createdAt: new Date().toISOString(),
  };
  messages.value = [...messages.value, assistant];
  activity.value = "Thinking...";
  loading.value = true;
  abortController.value?.abort();
  const controller = new AbortController();
  abortController.value = controller;
  const startedAt = performance.now();
  let text = "";
  let reasoning = "";
  const toolChips: ChatToolCall[] = [];

  try {
    const history: Record<string, unknown>[] = [];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const calls = new Map<string, ToolCall>();
      const connectionId = accountOptions.value.some(
        (account) => account.id === selectedAccount.value,
      )
        ? selectedAccount.value
        : undefined;
      const response = await api.dashboardChat.completions(
        format.value,
        requestBody(conversation, history, toolOptions()),
        controller.signal,
        connectionId,
      );
      // extractDelta separates reasoning from answer text. The stream reader
      // still reports plain text for payloads that extractDelta cannot parse.
      let handled = false;
      await readGatewayStream(
        response,
        (delta) => {
          if (handled) return;
          text += delta;
          updateAssistant(assistant.id, { content: text });
        },
        (payload) => {
          const delta = extractDelta(payload);
          handled = Boolean(delta.text || delta.reasoning);
          if (delta.reasoning) {
            reasoning += delta.reasoning;
            activity.value = "Thinking...";
          }
          if (delta.text) {
            text += delta.text;
            activity.value = "Responding...";
          }
          collectToolCall(payload, calls);
          const first = [...calls.values()].find((call) => call.name);
          if (first) activity.value = `Calling ${first.name}...`;
          if (handled)
            updateAssistant(assistant.id, { content: text, reasoning });
        },
      );
      const toolCalls = [...calls.values()].filter((call) => call.name);
      if (!toolCalls.length) break;
      if (round === MAX_TOOL_ROUNDS)
        throw new Error("The tool-call loop exceeded six rounds.");
      for (const call of toolCalls)
        toolChips.push({ id: call.id, name: call.name, status: "running" });
      updateAssistant(assistant.id, { tools: [...toolChips] });
      activity.value = `Running ${toolCalls[0].name}...`;
      const results = await Promise.all(
        toolCalls.map((call) => executeTool(call, controller.signal)),
      );
      for (const result of results) {
        const chip = toolChips.find((item) => item.id === result.call.id);
        if (chip) chip.status = result.isError ? "error" : "done";
      }
      updateAssistant(assistant.id, { tools: [...toolChips] });
      history.push(...buildToolHistory(toolCalls, results));
    }
    updateAssistant(assistant.id, {
      status: "done",
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (requestError) {
    const aborted =
      (requestError instanceof DOMException ||
        requestError instanceof Error) &&
      requestError.name === "AbortError";
    if (aborted) {
      updateAssistant(assistant.id, {
        status: "done",
        durationMs: Math.round(performance.now() - startedAt),
      });
      return;
    }
    updateAssistant(assistant.id, {
      status: "error",
      error:
        requestError instanceof Error
          ? requestError.message
          : "The gateway request failed.",
    });
  } finally {
    if (abortController.value === controller) abortController.value = null;
    loading.value = false;
  }
}

async function sendMessage() {
  const text = draft.value.trim();
  if (!text || !activeModel.value || loading.value) return;
  messages.value = [
    ...messages.value,
    {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    },
  ];
  draft.value = "";
  composer.value?.focus();
  await runAssistant();
}

async function regenerate() {
  if (!canRegenerate.value) return;
  messages.value = messages.value.slice(0, -1);
  await runAssistant();
}

function stopMessage() {
  abortController.value?.abort();
}

// Esc stops a reply even when focus has left the composer.
function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && loading.value && !clearConfirmOpen.value) {
    event.preventDefault();
    stopMessage();
  }
}

onActivated(() => window.addEventListener("keydown", onWindowKeydown));
onDeactivated(() => window.removeEventListener("keydown", onWindowKeydown));
onUnmounted(() => {
  window.removeEventListener("keydown", onWindowKeydown);
  abortController.value?.abort();
});
</script>

<template>
  <div class="theme-v2">
    <div
      v-if="models.isError.value"
      class="mb-4 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      Could not load the model catalog: {{ models.error.value?.message }}
    </div>
    <EmptyState
      v-if="!models.isPending.value && availableModels.length === 0"
      title="No chat models available"
      description="Add a provider connection or a custom chat model, then refresh this page to start chatting."
    />
    <Card
      v-else
      class="flex h-[calc(100dvh-8.5rem)] min-h-[30rem] flex-col overflow-hidden lg:h-[calc(100dvh-9rem)]"
    >
      <div
        class="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4"
      >
        <div class="min-w-0 flex-1 sm:w-72 sm:flex-none">
          <label for="chat-model" class="sr-only">Model</label>
          <ModelSelect
            id="chat-model"
            v-model="selectedModel"
            :models="availableModels"
            :disabled="loading || models.isPending.value"
          />
        </div>
        <div class="flex items-center gap-1 sm:order-last sm:ml-auto">
          <Button
            variant="ghost"
            size="icon"
            :disabled="models.isFetching.value"
            aria-label="Refresh models"
            title="Refresh models"
            @click="models.refetch()"
            ><RefreshCw
              :class="['size-4', models.isFetching.value && 'animate-spin']"
          /></Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="messages.length === 0 && !draft"
            aria-label="New chat"
            @click="
              loading || messages.length ? (clearConfirmOpen = true) : newChat()
            "
            ><Plus class="size-4" /><span class="hidden sm:inline"
              >New chat</span
            ></Button
          >
        </div>
        <div class="flex w-full gap-2 sm:w-auto">
          <div class="min-w-0 flex-1 sm:w-56 sm:flex-none">
            <label for="chat-account" class="sr-only">Account</label>
            <Combobox
              id="chat-account"
              v-model="selectedAccount"
              :options="accountSelectOptions"
              :disabled="
                loading || accounts.isFetching.value || !accountSupported
              "
              :title="
                accountSupported
                  ? 'Pin one account for this chat'
                  : 'This combo picks accounts by its own rules'
              "
              placeholder="Account"
              empty-text="No accounts available"
            />
          </div>
          <div class="w-36 shrink-0 sm:w-40">
            <label for="chat-format" class="sr-only">API format</label>
            <Select
              id="chat-format"
              v-model="format"
              :options="formatOptions"
              :disabled="loading"
            />
          </div>
        </div>
      </div>

      <div v-if="models.isPending.value" class="flex-1 space-y-4 p-6">
        <Skeleton v-for="item in 3" :key="item" class="h-14" />
      </div>
      <ChatMessageList
        v-else
        :messages="messages"
        :model-label="modelLabel"
        :loading="loading"
        :activity="activity"
        :can-regenerate="canRegenerate"
        @regenerate="regenerate"
      >
        <template #empty>
          <div
            class="mb-4 grid size-11 place-items-center rounded-xl bg-accent text-primary"
          >
            <MessageSquare class="size-5" />
          </div>
          <h2 class="text-lg font-semibold tracking-tight">
            Chat with {{ modelLabel }}
          </h2>
          <p class="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
            Prompts go through the same gateway route that your clients use.
            Pick a starting point or write your own message.
          </p>
          <div class="mt-6 grid w-full max-w-xl gap-2 text-left sm:grid-cols-2">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion.title"
              type="button"
              class="rounded-xl border border-border bg-background px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/60"
              @click="useSuggestion(suggestion.prompt, suggestion.mode)"
            >
              <span class="flex items-center gap-1.5 text-sm font-medium">
                <Brain
                  v-if="suggestion.mode === 'thinking'"
                  class="size-3.5 text-muted-foreground"
                />
                <Wrench
                  v-else-if="suggestion.mode === 'tools'"
                  class="size-3.5 text-muted-foreground"
                />
                {{ suggestion.title }}
              </span>
              <span
                class="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground"
                >{{ suggestion.prompt }}</span
              >
            </button>
          </div>
        </template>
      </ChatMessageList>

      <ChatComposer
        ref="composer"
        v-model="draft"
        :model-label="modelLabel"
        :loading="loading"
        :disabled="!activeModel"
        :placeholder="`Message ${modelLabel}`"
        @send="sendMessage"
        @stop="stopMessage"
      >
        <template #toolbar>
          <label for="chat-mode" class="sr-only">Mode</label>
          <Select
            id="chat-mode"
            v-model="mode"
            :options="modeOptions"
            :disabled="loading"
            class="h-8 w-auto border-transparent bg-transparent text-xs shadow-none hover:bg-muted"
          />
        </template>
      </ChatComposer>
    </Card>
    <ConfirmModal
      :open="clearConfirmOpen"
      title="Start a new chat"
      message="Start a new chat? The current conversation is removed from this browser."
      confirm-text="New chat"
      @confirm="newChat"
      @close="clearConfirmOpen = false"
    />
  </div>
</template>
