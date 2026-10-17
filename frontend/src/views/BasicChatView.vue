<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  History,
  MessageCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-vue-next";
import { api } from "@/lib/api";
import { readGatewayStream } from "@/lib/stream";
import type { ModelItem } from "@/types/api";
import type { ChatAttachment, ChatMessage } from "@/types/chat";
import Button from "@/components/ui/button.vue";
import Card from "@/components/ui/card.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import ModelSelect from "@/components/chat/ModelSelect.vue";
import ChatMessageList from "@/components/chat/ChatMessageList.vue";
import ChatComposer from "@/components/chat/ChatComposer.vue";
import PageHeader from "@/components/app/PageHeader.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";

interface BasicSession {
  id: string;
  title: string;
  modelId: string;
  updatedAt: string;
  messages: ChatMessage[];
}

const storageKey = "lobakai.v2.basic-chat.sessions";
const models = useQuery({
  queryKey: ["gateway-models", "basic-chat"],
  queryFn: () => api.gateway.models("chat"),
});
const sessions = ref<BasicSession[]>([]);
const activeSessionId = ref("");
const selectedModel = ref("");
const draft = ref("");
const attachments = ref<ChatAttachment[]>([]);
const loading = ref(false);
const error = ref("");
const streamingId = ref("");
const abortController = ref<AbortController | null>(null);
const deleteConfirmOpen = ref(false);

const availableModels = computed(() => models.data.value?.data || []);
const activeModel = computed(
  () =>
    availableModels.value.find((model) => model.id === selectedModel.value) ||
    availableModels.value[0] ||
    null,
);
const currentSession = computed(
  () =>
    sessions.value.find((session) => session.id === activeSessionId.value) ||
    null,
);
const sortedSessions = computed(() =>
  [...sessions.value].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  ),
);

function makeId() {
  return crypto.randomUUID();
}

function sessionTitle(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact
    ? compact.length > 52
      ? `${compact.slice(0, 52).trimEnd()}…`
      : compact
    : "New chat";
}

function loadSessions() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storageKey) || "[]",
    ) as unknown;
    if (Array.isArray(parsed))
      sessions.value = parsed.filter((value): value is BasicSession =>
        Boolean(
          value &&
          typeof value === "object" &&
          "id" in value &&
          "messages" in value,
        ),
      );
  } catch {
    sessions.value = [];
  }
  activeSessionId.value = sessions.value[0]?.id || "";
  selectedModel.value = sessions.value[0]?.modelId || selectedModel.value;
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(sessions.value));
}

function createSession(
  model: ModelItem | null = activeModel.value,
): BasicSession | null {
  if (!model) return null;
  const session: BasicSession = {
    id: makeId(),
    title: "New chat",
    modelId: model.id,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  sessions.value = [session, ...sessions.value];
  activeSessionId.value = session.id;
  selectedModel.value = model.id;
  return session;
}

function newChat() {
  createSession();
  draft.value = "";
  attachments.value = [];
  error.value = "";
}

function selectSession(session: BasicSession) {
  activeSessionId.value = session.id;
  selectedModel.value = session.modelId;
  error.value = "";
}

function updateCurrent(updater: (session: BasicSession) => BasicSession) {
  if (!activeSessionId.value) return;
  sessions.value = sessions.value.map((session) =>
    session.id === activeSessionId.value
      ? updater({ ...session, messages: [...session.messages] })
      : session,
  );
}

function deleteCurrent() {
  if (!activeSessionId.value) return;
  deleteConfirmOpen.value = false;
  sessions.value = sessions.value.filter(
    (session) => session.id !== activeSessionId.value,
  );
  activeSessionId.value = sessions.value[0]?.id || "";
  if (activeSessionId.value) selectedModel.value = sessions.value[0].modelId;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(reader.error || new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

async function attachFiles(files: FileList) {
  const imageFiles = [...files].filter((file) =>
    file.type.startsWith("image/"),
  );
  try {
    const next = await Promise.all(
      imageFiles.map(async (file) => ({
        id: makeId(),
        name: file.name,
        type: file.type,
        dataUrl: await fileToDataUrl(file),
      })),
    );
    attachments.value = [...attachments.value, ...next];
  } catch (attachError) {
    error.value =
      attachError instanceof Error
        ? attachError.message
        : "Could not attach image";
  }
}

function userContent(
  message: ChatMessage,
): string | Array<Record<string, unknown>> {
  if (!message.attachments?.length) return message.content;
  return [
    ...(message.content ? [{ type: "text", text: message.content }] : []),
    ...message.attachments.map((attachment) => ({
      type: "image_url",
      image_url: { url: attachment.dataUrl },
    })),
  ];
}

async function sendMessage() {
  const model = activeModel.value;
  const text = draft.value.trim();
  if (!model || loading.value || (!text && attachments.value.length === 0))
    return;
  let session = currentSession.value;
  if (!session) session = createSession(model);
  if (!session) return;
  const userMessage: ChatMessage = {
    id: makeId(),
    role: "user",
    content: text,
    attachments: [...attachments.value],
    createdAt: new Date().toISOString(),
  };
  const assistant: ChatMessage = {
    id: makeId(),
    role: "assistant",
    content: "",
    status: "streaming",
    createdAt: new Date().toISOString(),
  };
  const requestMessages = [...session.messages, userMessage].map((message) => ({
    role: message.role,
    content: message.role === "user" ? userContent(message) : message.content,
  }));
  updateCurrent((current) => ({
    ...current,
    modelId: model.id,
    title: current.title === "New chat" ? sessionTitle(text) : current.title,
    updatedAt: new Date().toISOString(),
    messages: [...current.messages, userMessage, assistant],
  }));
  draft.value = "";
  attachments.value = [];
  error.value = "";
  loading.value = true;
  streamingId.value = assistant.id;
  abortController.value?.abort();
  const controller = new AbortController();
  abortController.value = controller;
  let assistantText = "";
  try {
    const response = await api.gateway.post(
      "/v1/chat/completions",
      { model: model.id, messages: requestMessages, stream: true },
      controller.signal,
      { accept: "text/event-stream" },
    );
    await readGatewayStream(response, (delta) => {
      assistantText += delta;
      updateCurrent((current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        messages: current.messages.map((message) =>
          message.id === assistant.id
            ? { ...message, content: assistantText, status: "streaming" }
            : message,
        ),
      }));
    });
    if (!assistantText.trim())
      throw new Error("The gateway returned no assistant text.");
    updateCurrent((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      messages: current.messages.map((message) =>
        message.id === assistant.id ? { ...message, status: "done" } : message,
      ),
    }));
  } catch (requestError) {
    if (
      requestError instanceof DOMException &&
      requestError.name === "AbortError"
    )
      return;
    if (requestError instanceof Error && requestError.name === "AbortError")
      return;
    error.value =
      requestError instanceof Error
        ? requestError.message
        : "The gateway request failed.";
    updateCurrent((current) => ({
      ...current,
      messages: current.messages.map((message) =>
        message.id === assistant.id
          ? { ...message, status: "error", content: `Error: ${error.value}` }
          : message,
      ),
    }));
  } finally {
    if (abortController.value === controller) abortController.value = null;
    loading.value = false;
    streamingId.value = "";
  }
}

function stopMessage() {
  abortController.value?.abort();
  loading.value = false;
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(
    (attachment) => attachment.id !== id,
  );
}

watch([sessions, activeSessionId, selectedModel], persist, { deep: true });
watch(
  availableModels,
  (next) => {
    if (!next.some((model) => model.id === selectedModel.value))
      selectedModel.value =
        currentSession.value?.modelId &&
        next.some((model) => model.id === currentSession.value?.modelId)
          ? currentSession.value.modelId
          : next[0]?.id || "";
    if (!activeSessionId.value && next.length) createSession(next[0]);
  },
  { immediate: true },
);

onMounted(loadSessions);
onUnmounted(() => abortController.value?.abort());
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Basic chat"
      description="A lightweight local conversation workspace with persistent browser sessions and live gateway models."
      ><template #actions
        ><Button
          variant="outline"
          size="sm"
          :disabled="models.isFetching.value"
          @click="models.refetch()"
          ><RefreshCw
            :class="['size-4', models.isFetching.value && 'animate-spin']"
          />Refresh models</Button
        ><Button size="sm" @click="newChat"
          ><Plus class="size-4" />New chat</Button
        ></template
      ></PageHeader
    >
    <div
      v-if="models.isError.value"
      class="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {{ models.error.value?.message }}
    </div>
    <EmptyState
      v-if="!models.isPending.value && availableModels.length === 0"
      title="No chat models available"
      description="Add a provider model or a custom chat model in the v2 backend before starting a conversation."
    />
    <template v-else>
      <div
        class="grid min-h-[min(700px,calc(100vh-250px))] gap-4 xl:h-[calc(100dvh-17rem)] xl:grid-cols-[16rem_minmax(0,1fr)]"
      >
        <Card class="flex max-h-64 flex-col overflow-hidden xl:max-h-none"
          ><div
            class="flex items-center justify-between border-b border-border/70 px-4 py-3"
          >
            <div class="flex items-center gap-2 text-sm font-semibold">
              <History class="size-4 text-primary" />History
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="New chat"
              @click="newChat"
              ><Plus class="size-4"
            /></Button>
          </div>
          <div class="flex-1 space-y-1 overflow-y-auto p-2">
            <button
              v-for="session in sortedSessions"
              :key="session.id"
              type="button"
              :class="[
                'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                session.id === activeSessionId
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted',
              ]"
              @click="selectSession(session)"
            >
              <p class="truncate text-sm font-medium">{{ session.title }}</p>
              <p class="mt-1 truncate text-[11px] text-muted-foreground">
                {{ session.modelId }}
              </p>
            </button>
            <p
              v-if="!sortedSessions.length"
              class="px-3 py-4 text-xs text-muted-foreground"
            >
              No conversations yet.
            </p>
          </div>
          <div class="border-t border-border/70 p-2">
            <Button
              variant="ghost"
              class="w-full justify-start"
              :disabled="!currentSession"
              @click="deleteConfirmOpen = true"
              ><Trash2 class="size-4" />Delete current chat</Button
            >
          </div></Card
        >
        <Card class="flex min-h-0 flex-col overflow-hidden"
          ><div
            class="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5"
          >
            <div class="flex min-w-0 items-center gap-2">
              <MessageCircle class="size-4 shrink-0 text-primary" />
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold">
                  {{ currentSession?.title || "New chat" }}
                </p>
                <p class="truncate text-[11px] text-muted-foreground">
                  {{ activeModel?.id || "No model selected" }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <label
                for="basic-model"
                class="hidden text-xs text-muted-foreground sm:inline"
                >Model</label
              ><ModelSelect
                id="basic-model"
                v-model="selectedModel"
                :models="availableModels"
                :disabled="loading"
              />
            </div>
          </div>
          <div v-if="models.isPending.value" class="space-y-3 p-5">
            <Skeleton v-for="item in 4" :key="item" class="h-12" />
          </div>
          <ChatMessageList
            v-else
            :messages="currentSession?.messages || []"
            :model-label="activeModel?.id || 'Assistant'"
            :loading="loading"
            :activity="'Responding...'"
            empty-title="Start a conversation"
            empty-description="Choose a live model, write a message, and the response will be saved in this browser." /><ChatComposer
            v-model="draft"
            :model-label="activeModel?.id || 'No model'"
            :loading="loading"
            :error="error"
            :disabled="!activeModel"
            :attachments="attachments"
            allow-attachments
            @send="sendMessage"
            @stop="stopMessage"
            @attach="attachFiles"
            @remove-attachment="removeAttachment"
        /></Card>
      </div>
    </template>
    <ConfirmModal
      :open="deleteConfirmOpen"
      title="Delete chat"
      :message="`Delete ${currentSession?.title || 'this chat'}? This action cannot be undone.`"
      confirm-text="Delete"
      @confirm="deleteCurrent"
      @close="deleteConfirmOpen = false"
    />
  </div>
</template>
