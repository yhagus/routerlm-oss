<script setup lang="ts">
// Port of v1 token-saver/TokenSaverClient.js (PXPIPE row is dead code in v1 — stays hidden here).
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { api } from "@/lib/api";
import Button from "@/components/ui/button.vue";
import Card from "@/components/ui/card.vue";
import Input from "@/components/ui/input.vue";
import Modal from "@/components/ui/modal.vue";
import Toggle from "@/components/ui/toggle.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";

const CAVEMAN_LEVELS = [
  { id: "lite", label: "Lite", desc: "Drop filler, keep grammar" },
  { id: "full", label: "Full", desc: "Drop articles, fragments OK" },
  { id: "ultra", label: "Ultra", desc: "Telegraphic, max compression" },
];
const PONYTAIL_LEVELS = [
  { id: "lite", label: "Lite", desc: "Build asked, name lazier option" },
  { id: "full", label: "Full", desc: "Ladder enforced: stdlib/native first" },
  { id: "ultra", label: "Ultra", desc: "YAGNI extremist, deletion first" },
];

const rtkEnabled = ref(true);
const headroomEnabled = ref(false);
const headroomUrl = ref("http://localhost:8787");
const headroomStatus = ref<Record<string, any>>({
  installed: false,
  running: false,
  python: null,
  loading: true,
});
const showHeadroomInstallModal = ref(false);
const headroomActionLoading = ref(false);
const headroomActionError = ref("");
const headroomExtras = ref<Record<string, any>>({
  version: null,
  extras: { code: false, ml: false },
  available: ["code", "ml"],
  loading: false,
});
const pendingExtras = ref<string[]>([]);
const extrasActionLoading = ref(false);
const extrasActionError = ref("");
const removingExtra = ref<string | null>(null);
const installLog = ref("");
const extrasConfirm = ref<{
  title: string;
  message: string;
  confirmText: string;
  action: () => void;
} | null>(null);
const codeAware = ref(false);
const kompress = ref(true);
const restartingProxy = ref(false);
const cavemanEnabled = ref(false);
const cavemanLevel = ref("full");
const ponytailEnabled = ref(false);
const ponytailLevel = ref("full");
const copied = ref(false);

let logPollId: number | undefined;

async function patchSetting(patch: Record<string, unknown>) {
  try {
    await api.settings.update(patch);
  } catch {
    /* v1 logs and ignores */
  }
}

function handleRtkEnabled(value: boolean) {
  patchSetting({ rtkEnabled: value }).then(() => {
    rtkEnabled.value = value;
  });
}

function handleCavemanEnabled(value: boolean) {
  cavemanEnabled.value = value;
  patchSetting({ cavemanEnabled: value });
}

function handleCavemanLevel(level: string) {
  cavemanLevel.value = level;
  patchSetting({ cavemanLevel: level });
}

function handlePonytailEnabled(value: boolean) {
  ponytailEnabled.value = value;
  patchSetting({ ponytailEnabled: value });
}

function handlePonytailLevel(level: string) {
  ponytailLevel.value = level;
  patchSetting({ ponytailLevel: level });
}

function handleHeadroomEnabled(value: boolean) {
  const nextUrl = headroomUrl.value.trim() || "http://localhost:8787";
  headroomUrl.value = nextUrl;
  headroomEnabled.value = value;
  patchSetting({ headroomEnabled: value, headroomUrl: nextUrl });
}

async function handleHeadroomUrlBlur() {
  const next = headroomUrl.value.trim() || "http://localhost:8787";
  headroomUrl.value = next;
  await patchSetting({ headroomUrl: next });
  refreshHeadroomStatus();
}

async function refreshHeadroomStatus() {
  headroomStatus.value = { ...headroomStatus.value, loading: true };
  try {
    const data = await api.host.headroom.status();
    headroomStatus.value = { ...data, loading: false };
    if (!data?.installed) {
      headroomExtras.value = {
        version: null,
        extras: { code: false, ml: false },
        available: ["code", "ml"],
        loading: false,
      };
      pendingExtras.value = [];
      return;
    }
    try {
      const extrasData = await api.host.headroom.extras();
      headroomExtras.value = {
        version: (extrasData as Record<string, any>).version ?? null,
        extras: (extrasData as Record<string, any>).extras || {
          code: false,
          ml: false,
        },
        available: (extrasData as Record<string, any>).available || [
          "code",
          "ml",
        ],
        loading: false,
      };
      pendingExtras.value = [];
    } catch {
      headroomExtras.value = {
        version: null,
        extras: { code: false, ml: false },
        available: ["code", "ml"],
        loading: false,
      };
      pendingExtras.value = [];
    }
  } catch {
    headroomStatus.value = {
      installed: false,
      running: false,
      python: null,
      loading: false,
    };
    headroomExtras.value = {
      version: null,
      extras: { code: false, ml: false },
      available: ["code", "ml"],
      loading: false,
    };
    pendingExtras.value = [];
  }
}

async function handleHeadroomStart() {
  headroomActionError.value = "";
  headroomActionLoading.value = true;
  try {
    await api.host.headroom.start();
    await refreshHeadroomStatus();
  } catch (error) {
    headroomActionError.value =
      error instanceof Error ? error.message : "Failed to start proxy";
  } finally {
    headroomActionLoading.value = false;
  }
}

async function handleHeadroomStop() {
  if (!window.confirm("Stop the Headroom proxy?")) return;
  headroomActionLoading.value = true;
  try {
    await api.host.headroom.stop();
    await refreshHeadroomStatus();
  } finally {
    headroomActionLoading.value = false;
  }
}

function togglePendingExtra(extra: string) {
  pendingExtras.value = pendingExtras.value.includes(extra)
    ? pendingExtras.value.filter((item) => item !== extra)
    : [...pendingExtras.value, extra];
}

function startLogPolling() {
  installLog.value = "";
  if (logPollId) window.clearInterval(logPollId);
  const tick = async () => {
    try {
      const data = await api.host.headroom.extras(true);
      if (typeof (data as Record<string, any>).log === "string")
        installLog.value = (data as Record<string, any>).log;
    } catch {
      /* ignore transient poll errors */
    }
  };
  tick();
  logPollId = window.setInterval(tick, 1500);
}

function stopLogPolling() {
  if (logPollId) {
    window.clearInterval(logPollId);
    logPollId = undefined;
  }
}

async function installExtrasConfirmed() {
  if (pendingExtras.value.length === 0) return;
  extrasActionLoading.value = true;
  extrasActionError.value = "";
  startLogPolling();
  try {
    const data = await api.host.headroom.installExtras(pendingExtras.value);
    headroomExtras.value = {
      ...headroomExtras.value,
      version:
        (data as Record<string, any>).version ?? headroomExtras.value.version,
      extras:
        (data as Record<string, any>).extras || headroomExtras.value.extras,
    };
    pendingExtras.value = [];
  } catch (error) {
    extrasActionError.value =
      error instanceof Error ? error.message : "Install failed";
  } finally {
    stopLogPolling();
    extrasActionLoading.value = false;
  }
}

function handleInstallExtras() {
  if (pendingExtras.value.length === 0) return;
  if (pendingExtras.value.includes("ml")) {
    extrasConfirm.value = {
      title: "Install [ml]",
      message: "[ml] downloads ~1 GB (torch + huggingface-hub). Continue?",
      confirmText: "Install",
      action: installExtrasConfirmed,
    };
    return;
  }
  installExtrasConfirmed();
}

function handleRemoveExtra(extra: string) {
  extrasConfirm.value = {
    title: `Remove [${extra}]`,
    message: `Remove [${extra}] and its packages?`,
    confirmText: "Remove",
    action: () => removeExtraConfirmed(extra),
  };
}

async function removeExtraConfirmed(extra: string) {
  removingExtra.value = extra;
  extrasActionError.value = "";
  startLogPolling();
  try {
    const data = await api.host.headroom.removeExtras([extra]);
    headroomExtras.value = {
      ...headroomExtras.value,
      version:
        (data as Record<string, any>).version ?? headroomExtras.value.version,
      extras:
        (data as Record<string, any>).extras || headroomExtras.value.extras,
    };
  } catch (error) {
    extrasActionError.value =
      error instanceof Error ? error.message : "Remove failed";
  } finally {
    stopLogPolling();
    removingExtra.value = null;
  }
}

async function toggleExtraActive(extra: string, value: boolean) {
  extrasActionError.value = "";
  if (extra === "code") codeAware.value = value;
  if (extra === "ml") kompress.value = value;
  const key = extra === "code" ? "headroomCodeAware" : "headroomKompress";
  await patchSetting({ [key]: value });
  if (!headroomStatus.value.running) return;
  restartingProxy.value = true;
  try {
    await api.host.headroom.restart();
    await refreshHeadroomStatus();
  } catch (error) {
    extrasActionError.value =
      error instanceof Error ? error.message : "Restart failed";
  } finally {
    restartingProxy.value = false;
  }
}

async function copyInstallCommand() {
  await navigator.clipboard?.writeText('pip install "headroom-ai[proxy]"');
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 2000);
}

function handleExtrasConfirm() {
  const action = extrasConfirm.value?.action;
  extrasConfirm.value = null;
  action?.();
}

const headroomRunning = computed(() => !!headroomStatus.value.running);
const headroomStatusLabel = computed(() => {
  if (headroomStatus.value.loading) return "Checking…";
  if (headroomRunning.value) return "Running";
  if (
    headroomStatus.value.localUrl !== false &&
    !headroomStatus.value.installed
  )
    return "Not installed";
  if (headroomStatus.value.localUrl !== false) return "Stopped";
  return "External";
});
const headroomLocalUrl = computed(
  () => headroomStatus.value.localUrl !== false,
);
const headroomCanStart = computed(() => !!headroomStatus.value.canStart);
const headroomManaged = computed(
  () => headroomLocalUrl.value && !!headroomStatus.value.managedPid,
);
const currentCavemanDesc = computed(
  () =>
    CAVEMAN_LEVELS.find((level) => level.id === cavemanLevel.value)?.desc || "",
);
const currentPonytailDesc = computed(
  () =>
    PONYTAIL_LEVELS.find((level) => level.id === ponytailLevel.value)?.desc ||
    "",
);

onMounted(async () => {
  try {
    const data = (await api.settings.get()) as Record<string, any>;
    rtkEnabled.value = data.rtkEnabled !== false;
    headroomEnabled.value = !!data.headroomEnabled;
    headroomUrl.value = data.headroomUrl || "http://localhost:8787";
    codeAware.value = data.headroomCodeAware === true;
    kompress.value = data.headroomKompress !== false;
    cavemanEnabled.value = !!data.cavemanEnabled;
    cavemanLevel.value = data.cavemanLevel || "full";
    ponytailEnabled.value = !!data.ponytailEnabled;
    ponytailLevel.value = data.ponytailLevel || "full";
    refreshHeadroomStatus();
  } catch {
    /* defaults */
  }
});

onUnmounted(stopLogPolling);
</script>

<template>
  <div class="space-y-6">
    <Card class="p-6">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <span class="material-symbols-outlined text-primary">bolt</span>
          Token Saver
        </h2>
      </div>

      <!-- RTK -->
      <div
        class="flex items-center justify-between gap-4 border-b border-border pb-4 pt-2"
      >
        <div class="min-w-0 flex-1">
          <p class="font-medium">
            Compress tool output
            <a
              href="https://github.com/rtk-ai/rtk"
              target="_blank"
              rel="noreferrer"
              class="text-xs font-normal text-primary underline hover:opacity-80"
              >(RTK)</a
            >
          </p>
          <p class="text-sm text-muted-foreground">
            git/grep/ls/tree/logs → 60-90% fewer input tokens
          </p>
        </div>
        <Toggle
          :checked="rtkEnabled"
          @change="(value: boolean) => handleRtkEnabled(!rtkEnabled)"
        />
      </div>

      <!-- Headroom -->
      <div class="flex flex-wrap items-center justify-between gap-4 py-4">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-3">
            <p class="font-medium">
              Compress context
              <a
                href="https://github.com/chopratejas/headroom"
                target="_blank"
                rel="noreferrer"
                class="text-xs font-normal text-primary underline hover:opacity-80"
                >(Headroom)</a
              >
            </p>
            <span
              class="rounded px-2 py-0.5 text-xs"
              :class="
                headroomRunning
                  ? 'bg-success/15 text-success'
                  : 'bg-warning/15 text-warning'
              "
              >{{ headroomStatusLabel }}</span
            >
            <button
              type="button"
              class="text-xs text-primary underline hover:opacity-80"
              @click="showHeadroomInstallModal = true"
            >
              {{ headroomRunning ? "Manage" : "Setup" }}
            </button>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            Compress prompts via /v1/compress before routing to the model
          </p>
        </div>
        <Toggle
          :checked="headroomEnabled && headroomRunning"
          :disabled="!headroomRunning"
          @change="(value: boolean) => handleHeadroomEnabled(!headroomEnabled)"
        />
      </div>

      <!-- Headroom extras -->
      <div
        v-if="headroomStatus.installed"
        class="mb-3 ml-1 border-l-2 border-border pb-4 pl-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-muted-foreground">
            Compression extras{{
              headroomExtras.version ? ` · v${headroomExtras.version}` : ""
            }}:
          </span>
          <template v-for="extra in headroomExtras.available" :key="extra">
            <div
              v-if="headroomExtras.extras?.[extra]"
              class="flex items-center gap-1.5 rounded border border-success/40 bg-success/5 px-2 py-1 text-xs"
              :title="
                extra === 'code'
                  ? 'tree-sitter AST compression for code responses'
                  : 'Kompress-v2 HF model for prose/agentic traces (~+1GB)'
              "
            >
              <Toggle
                size="sm"
                :checked="extra === 'code' ? codeAware : kompress"
                :disabled="restartingProxy"
                @change="
                  (value: boolean) =>
                    toggleExtraActive(
                      extra,
                      !(extra === 'code' ? codeAware : kompress),
                    )
                "
              />
              <span class="font-medium">[{{ extra }}]</span>
              <button
                type="button"
                :disabled="removingExtra === extra"
                class="ml-1 text-destructive underline hover:opacity-80 disabled:opacity-50"
                :title="`Uninstall [${extra}]`"
                @click="handleRemoveExtra(extra)"
              >
                {{ removingExtra === extra ? "Uninstalling…" : "Uninstall" }}
              </button>
            </div>
            <label
              v-else
              class="flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors"
              :class="
                pendingExtras.includes(extra)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-secondary'
              "
              :title="
                extra === 'code'
                  ? 'tree-sitter AST compression for code responses'
                  : 'Kompress-v2 HF model for prose/agentic traces (~+1GB)'
              "
            >
              <input
                type="checkbox"
                class="h-3 w-3"
                :checked="pendingExtras.includes(extra)"
                @change="togglePendingExtra(extra)"
              />
              <span class="font-medium">[{{ extra }}]</span>
              <span class="opacity-70">not installed</span>
            </label>
          </template>
          <button
            v-if="pendingExtras.length > 0"
            :disabled="extrasActionLoading"
            class="rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
            @click="handleInstallExtras"
          >
            {{
              extrasActionLoading
                ? "Installing…"
                : `Install [proxy,${pendingExtras.join(",")}]`
            }}
          </button>
        </div>
        <p v-if="extrasActionError" class="mt-1 text-xs text-destructive">
          {{ extrasActionError }}
        </p>
        <p v-if="restartingProxy" class="mt-1 text-xs text-muted-foreground">
          Restarting proxy…
        </p>
        <pre
          v-if="(extrasActionLoading || removingExtra) && installLog"
          class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2 text-[10px] leading-tight text-muted-foreground"
          >{{ installLog }}</pre>
        <p class="mt-1 text-xs text-muted-foreground">
          Installing adds the package; use <code>on</code>/<code>off</code> to
          activate it (restarts the proxy). Default install is
          <code>[proxy]</code> only (SmartCrusher for JSON). Adding
          <code>[code]</code> enables AST compression
          (Python/JS/TS/Go/Rust/Java/C/C++/Perl). Adding
          <code>[ml]</code> enables the Kompress-v2 HF model for prose/agentic
          traces but adds ~1 GB (torch + huggingface-hub).
        </p>
      </div>

      <!-- Caveman -->
      <div
        class="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4"
      >
        <div class="min-w-0 flex-1">
          <p class="font-medium">
            Compress LLM output
            <a
              href="https://github.com/JuliusBrussee/caveman"
              target="_blank"
              rel="noreferrer"
              class="text-xs font-normal text-primary underline hover:opacity-80"
              >(Caveman)</a
            >
          </p>
          <p class="text-sm text-muted-foreground">
            Terse-style system prompt → ~65% fewer output tokens (up to 87%)
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <div v-if="cavemanEnabled" class="flex flex-col items-end gap-1">
            <div class="flex items-center gap-1.5">
              <button
                v-for="level in CAVEMAN_LEVELS"
                :key="level.id"
                type="button"
                class="rounded border px-3 py-1.5 text-xs font-medium transition-colors"
                :class="
                  cavemanLevel === level.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-secondary'
                "
                :title="level.desc"
                @click="handleCavemanLevel(level.id)"
              >
                {{ level.label }}
              </button>
            </div>
            <p class="text-xs text-primary">{{ currentCavemanDesc }}</p>
          </div>
          <Toggle
            :checked="cavemanEnabled"
            @change="(value: boolean) => handleCavemanEnabled(!cavemanEnabled)"
          />
        </div>
      </div>

      <!-- Ponytail -->
      <div
        class="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4"
      >
        <div class="min-w-0 flex-1">
          <p class="font-medium">
            Lazy senior dev
            <a
              href="https://github.com/DietrichGebert/ponytail"
              target="_blank"
              rel="noreferrer"
              class="text-xs font-normal text-primary underline hover:opacity-80"
              >(Ponytail)</a
            >
          </p>
          <p class="text-sm text-muted-foreground">
            Bias the model toward minimal code: YAGNI, reuse stdlib, deletion
            over addition
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <div v-if="ponytailEnabled" class="flex flex-col items-end gap-1">
            <div class="flex items-center gap-1.5">
              <button
                v-for="level in PONYTAIL_LEVELS"
                :key="level.id"
                type="button"
                class="rounded border px-3 py-1.5 text-xs font-medium transition-colors"
                :class="
                  ponytailLevel === level.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-secondary'
                "
                :title="level.desc"
                @click="handlePonytailLevel(level.id)"
              >
                {{ level.label }}
              </button>
            </div>
            <p class="text-xs text-primary">{{ currentPonytailDesc }}</p>
          </div>
          <Toggle
            :checked="ponytailEnabled"
            @change="
              (value: boolean) => handlePonytailEnabled(!ponytailEnabled)
            "
          />
        </div>
      </div>
    </Card>

    <!-- Headroom setup/manage modal -->
    <Modal
      :open="showHeadroomInstallModal"
      :title="headroomRunning ? 'Headroom' : 'Setup Headroom'"
      @close="showHeadroomInstallModal = false"
    >
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between text-sm">
          <span>Status</span>
          <span :class="headroomRunning ? 'text-success' : 'text-warning'">{{
            headroomStatusLabel
          }}</span>
        </div>
        <a
          v-if="headroomRunning"
          href="/api/headroom/proxy/dashboard"
          target="_blank"
          rel="noreferrer"
          class="w-full rounded border border-border px-4 py-2 text-center text-sm hover:bg-secondary"
          >Open Headroom Dashboard</a
        >
        <div class="flex flex-col gap-1">
          <p class="text-sm font-medium">Proxy URL</p>
          <Input
            v-model="headroomUrl"
            placeholder="http://localhost:8787"
            class="font-mono text-sm"
            @blur="handleHeadroomUrlBlur"
          />
          <p class="text-xs text-muted-foreground">
            Use a local proxy for Start/Stop, or an external Docker sidecar like
            http://headroom:8787.
          </p>
        </div>
        <Button
          v-if="headroomManaged"
          variant="ghost"
          class="w-full"
          :disabled="headroomActionLoading"
          @click="handleHeadroomStop"
        >
          {{ headroomActionLoading ? "Stopping…" : "Stop Headroom" }}
        </Button>
        <p v-else-if="headroomRunning" class="text-sm text-success">
          Headroom proxy is reachable. You can enable the token saver.
        </p>
        <Button
          v-else-if="headroomCanStart"
          class="w-full"
          :disabled="headroomActionLoading"
          @click="handleHeadroomStart"
        >
          {{ headroomActionLoading ? "Starting…" : "Start Headroom" }}
        </Button>
        <p v-else-if="!headroomLocalUrl" class="text-sm text-warning">
          Start Headroom separately at the configured URL, then recheck.
        </p>
        <p v-else-if="!headroomStatus.python" class="text-sm text-warning">
          Python ≥ 3.10 required for local managed mode. Install Python first,
          or use an external proxy URL.
        </p>
        <div v-else class="flex flex-col gap-1">
          <p class="text-sm font-medium">Install then click Start:</p>
          <div class="flex items-center gap-2">
            <pre
              class="flex-1 overflow-x-auto rounded bg-black/5 p-2 font-mono text-xs dark:bg-white/5"
            >
pip install "headroom-ai[proxy]"</pre>
            <Button size="sm" variant="ghost" @click="copyInstallCommand">{{
              copied ? "Copied" : "Copy"
            }}</Button>
          </div>
        </div>
        <p v-if="headroomActionError" class="text-sm text-warning">
          {{ headroomActionError }}
        </p>
        <div class="flex gap-2">
          <Button
            variant="ghost"
            class="w-full"
            @click="refreshHeadroomStatus()"
            >Recheck</Button
          >
          <Button class="w-full" @click="showHeadroomInstallModal = false"
            >Done</Button
          >
        </div>
      </div>
    </Modal>

    <ConfirmModal
      :open="Boolean(extrasConfirm)"
      :title="extrasConfirm?.title"
      :message="extrasConfirm?.message"
      :confirm-text="extrasConfirm?.confirmText"
      @confirm="handleExtrasConfirm"
      @close="extrasConfirm = null"
    />
  </div>
</template>
