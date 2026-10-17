<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import { api } from "@/lib/api";

const logs = ref<string[]>([]);
const logRef = ref<HTMLElement | null>(null);
const clearConfirmOpen = ref(false);
const clearing = ref(false);
let stream: EventSource | null = null;

function append(lines: string[]) {
  logs.value = [...logs.value, ...lines].slice(-1000);
}

function handleStreamEvent(event: MessageEvent<string>) {
  try {
    const payload = JSON.parse(event.data) as {
      type?: string;
      logs?: unknown;
      line?: unknown;
      lines?: unknown;
    };
    if (payload.type === "init" && Array.isArray(payload.logs))
      logs.value = payload.logs
        .filter((line): line is string => typeof line === "string")
        .slice(-1000);
    if (payload.type === "line" && typeof payload.line === "string")
      append([payload.line]);
    if (payload.type === "lines" && Array.isArray(payload.lines))
      append(
        payload.lines.filter(
          (line): line is string => typeof line === "string",
        ),
      );
    if (payload.type === "clear") logs.value = [];
  } catch {
    // Ignore malformed stream records.
  }
}

function color(line: string) {
  if (line.includes("[ERROR]")) return "text-red-400";
  if (line.includes("[WARN]")) return "text-yellow-400";
  if (line.includes("[INFO]")) return "text-blue-400";
  if (line.includes("[DEBUG]")) return "text-purple-400";
  return "text-green-400";
}

async function clearLogs() {
  clearing.value = true;
  try {
    await api.translator.clearLogs();
    logs.value = [];
    clearConfirmOpen.value = false;
  } finally {
    clearing.value = false;
  }
}

watch(logs, async () => {
  await nextTick();
  if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight;
});

onMounted(() => {
  stream = new EventSource("/api/translator/console-logs/stream");
  stream.onmessage = handleStreamEvent;
});

onUnmounted(() => stream?.close());
</script>

<template>
  <Card class="theme-v2 overflow-hidden">
    <div class="flex justify-end px-4 pb-2 pt-3">
      <Button
        variant="outline"
        :disabled="clearing"
        @click="clearConfirmOpen = true"
        ><span class="material-symbols-outlined text-[16px]">delete</span
        >Clear</Button
      >
    </div>
    <div
      ref="logRef"
      class="h-[calc(100vh-220px)] overflow-y-auto rounded-b-lg bg-black p-4 font-mono text-xs"
    >
      <span v-if="!logs.length" class="text-muted-foreground"
        >No console logs yet.</span
      >
      <div v-else class="space-y-0.5">
        <div v-for="(line, index) in logs" :key="index" :class="color(line)">
          {{ line }}
        </div>
      </div>
    </div>
  </Card>
  <ConfirmModal
    :open="clearConfirmOpen"
    title="Clear console logs"
    message="Delete all console logs? This action cannot be undone."
    confirm-text="Clear"
    :loading="clearing"
    @confirm="clearLogs"
    @close="!clearing && (clearConfirmOpen = false)"
    class="theme-v2"
  />
</template>
