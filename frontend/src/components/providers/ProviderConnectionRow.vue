<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ProviderConnection, ProxyPool } from "@/types/api";
import { api } from "@/lib/api";
import Badge from "@/components/ui/badge.vue";
import Toggle from "@/components/ui/toggle.vue";
import CooldownTimer from "@/components/providers/CooldownTimer.vue";

type TestState = {
  state: "queued" | "testing" | "success" | "failed" | "cancelled";
  error?: string | null;
} | null;

const props = defineProps<{
  connection: ProviderConnection;
  proxyPools: ProxyPool[];
  isOauth: boolean;
  isFirst: boolean;
  isLast: boolean;
  oneByOneStatus?: TestState;
  autoPing?: { on: boolean; provider: string } | null;
}>();
const emit = defineEmits<{
  moveUp: [];
  moveDown: [];
  toggleActive: [isActive: boolean];
  updateProxy: [poolId: string | null];
  edit: [];
  delete: [];
  autoPing: [on: boolean];
  tested: [result: { ok: boolean; error?: string }];
}>();

const showProxyDropdown = ref(false);
const updatingProxy = ref(false);
const testing = ref(false);
const proxyDropdownRef = ref<HTMLElement | null>(null);
const nowMs = ref(Date.now());
let tick: number | undefined;

function field<T>(name: string, fallback: T): T {
  const value =
    (props.connection as unknown as Record<string, unknown>)[name] ??
    (props.connection.data as Record<string, unknown> | undefined)?.[name];
  return (value === undefined || value === null ? fallback : value) as T;
}

const proxyPoolMap = computed(
  () => new Map(props.proxyPools.map((pool) => [pool.id, pool])),
);
const boundProxyPoolId = computed(
  () => field<string | null>("proxyPoolId", null) || null,
);
const boundProxyPool = computed(() =>
  boundProxyPoolId.value
    ? proxyPoolMap.value.get(boundProxyPoolId.value) || null
    : null,
);
const hasLegacyProxy = computed(
  () =>
    field("connectionProxyEnabled", false as boolean) === true &&
    Boolean(field("connectionProxyUrl", "")),
);
const hasAnyProxy = computed(
  () => Boolean(boundProxyPoolId.value) || hasLegacyProxy.value,
);
const proxyDisplayText = computed(() => {
  if (boundProxyPool.value) return `Pool: ${boundProxyPool.value.name}`;
  if (boundProxyPoolId.value)
    return `Pool: ${boundProxyPoolId.value} (inactive/missing)`;
  if (hasLegacyProxy.value) return `Legacy: ${field("connectionProxyUrl", "")}`;
  return "";
});
const maskedProxyUrl = computed(() => {
  const raw = String(
    boundProxyPool.value?.proxyUrl || field("connectionProxyUrl", "") || "",
  );
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return raw;
  }
});
const noProxyText = computed(() =>
  String(boundProxyPool.value?.noProxy || field("connectionNoProxy", "") || ""),
);
const proxyBadgeVariant = computed(() => {
  if (boundProxyPool.value?.isActive === true) return "success";
  if (boundProxyPoolId.value || hasLegacyProxy.value) return "destructive";
  return "secondary";
});
const autoPingTooltip = computed(() =>
  props.autoPing?.provider === "codex"
    ? "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota."
    : props.autoPing?.provider === "autoclaw"
      ? "Automatically claims the daily check-in reward once per day."
      : "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.",
);
const autoPingLabel = computed(() =>
  props.autoPing?.provider === "autoclaw" ? "Auto-claim" : "Auto-ping",
);

const rowAuthType = computed(() =>
  String(props.connection.authType || (props.isOauth ? "oauth" : "apikey")),
);
const isOAuthConnection = computed(() => rowAuthType.value === "oauth");
const isCookieConnection = computed(() => rowAuthType.value === "cookie");
const authIcon = computed(() =>
  isCookieConnection.value
    ? "cookie"
    : isOAuthConnection.value
      ? "lock"
      : "key",
);
const authLabel = computed(() =>
  isOAuthConnection.value
    ? "OAuth"
    : isCookieConnection.value
      ? "Cookie"
      : "API Key",
);
const displayName = computed(
  () =>
    props.connection.name?.trim() ||
    props.connection.email?.trim() ||
    String(field("displayName", "") || "").trim() ||
    (isOAuthConnection.value
      ? "OAuth Account"
      : isCookieConnection.value
        ? "Cookie Account"
        : "API Key"),
);
const secondaryDisplayName = computed(() => {
  const name = props.connection.name?.trim();
  const email = props.connection.email?.trim();
  const display = String(field("displayName", "") || "").trim();
  if (name && email && name !== email) return email;
  if (name && display && name !== display) return display;
  return null;
});

const modelLockUntil = computed(() => {
  const source = {
    ...(props.connection as unknown as Record<string, unknown>),
    ...((props.connection.data as Record<string, unknown> | undefined) || {}),
  };
  return (
    Object.entries(source)
      .filter(([key, value]) => key.startsWith("modelLock_") && value)
      .map(([, value]) => String(value))
      .filter((value) => new Date(value).getTime() > nowMs.value)
      .sort()[0] || null
  );
});
const isCooldown = computed(() => Boolean(modelLockUntil.value));
const effectiveStatus = computed(() =>
  field("testStatus", "" as string) === "unavailable" && !isCooldown.value
    ? "active"
    : field("testStatus", "" as string),
);

// v1 getStatusVariant: cooldown-expired "unavailable" reads as active.
const statusVariant = computed(() => {
  if (props.connection.isActive === false) return "secondary";
  if (effectiveStatus.value === "active" || effectiveStatus.value === "success")
    return "success";
  if (
    effectiveStatus.value === "error" ||
    effectiveStatus.value === "expired" ||
    effectiveStatus.value === "unavailable"
  )
    return "destructive";
  return "secondary";
});

const oneByOneVariant = computed(() => {
  if (!props.oneByOneStatus) return "secondary";
  if (props.oneByOneStatus.state === "success") return "success";
  if (props.oneByOneStatus.state === "failed") return "destructive";
  if (props.oneByOneStatus.state === "testing") return "default";
  return "secondary";
});
const oneByOneLabel = computed(() => {
  const status = props.oneByOneStatus;
  if (!status) return null;
  if (status.state === "queued") return "queued";
  if (status.state === "testing") return "testing";
  if (status.state === "success") return "success";
  if (status.state === "cancelled") return "cancelled";
  if (status.state === "failed")
    return status.error ? `failed: ${status.error}` : "failed";
  return null;
});

function onDocClick(event: MouseEvent) {
  if (
    showProxyDropdown.value &&
    proxyDropdownRef.value &&
    !proxyDropdownRef.value.contains(event.target as Node)
  )
    showProxyDropdown.value = false;
}
onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  tick = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
  if (tick) window.clearInterval(tick);
});

async function selectProxy(poolId: string) {
  updatingProxy.value = true;
  try {
    emit("updateProxy", poolId === "__none__" ? null : poolId);
  } finally {
    updatingProxy.value = false;
    showProxyDropdown.value = false;
  }
}

async function testConnection() {
  if (testing.value || props.connection.isActive === false) return;
  testing.value = true;
  try {
    const result = await api.providers.test(props.connection.id);
    emit("tested", { ok: Boolean(result.valid), error: result.error });
  } catch (error) {
    emit("tested", {
      ok: false,
      error: error instanceof Error ? error.message : "Test failed",
    });
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div
    class="group flex min-w-0 flex-col gap-3 rounded-lg p-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between"
    :class="{ 'opacity-60': connection.isActive === false }"
  >
    <div class="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
      <div class="flex shrink-0 flex-col">
        <button
          class="rounded p-0.5"
          :class="
            isFirst
              ? 'cursor-not-allowed text-muted-foreground/30'
              : 'text-muted-foreground hover:bg-sidebar hover:text-primary'
          "
          :disabled="isFirst"
          aria-label="Move up"
          @click="emit('moveUp')"
        >
          <span class="material-symbols-outlined text-sm"
            >keyboard_arrow_up</span
          >
        </button>
        <button
          class="rounded p-0.5"
          :class="
            isLast
              ? 'cursor-not-allowed text-muted-foreground/30'
              : 'text-muted-foreground hover:bg-sidebar hover:text-primary'
          "
          :disabled="isLast"
          aria-label="Move down"
          @click="emit('moveDown')"
        >
          <span class="material-symbols-outlined text-sm"
            >keyboard_arrow_down</span
          >
        </button>
      </div>
      <span
        class="material-symbols-outlined shrink-0 text-base text-muted-foreground"
        >{{ authIcon }}</span
      >
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">{{ displayName }}</p>
        <p
          v-if="secondaryDisplayName"
          class="truncate text-xs text-muted-foreground"
        >
          {{ secondaryDisplayName }}
        </p>
        <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
          <Badge :variant="statusVariant" dot>{{
            connection.isActive === false
              ? "disabled"
              : effectiveStatus || "Unknown"
          }}</Badge>
          <Badge variant="outline">{{ authLabel }}</Badge>
          <Badge v-if="String(field('group', '')).trim()" variant="info">{{
            String(field("group", "")).trim()
          }}</Badge>
          <Badge v-if="hasAnyProxy" :variant="proxyBadgeVariant">Proxy</Badge>
          <CooldownTimer
            v-if="isCooldown && connection.isActive !== false"
            :until="modelLockUntil"
          />
          <span
            v-if="field('lastError', '') && connection.isActive !== false"
            class="max-w-full truncate text-xs text-red-500 sm:max-w-[300px]"
            :title="String(field('lastError', ''))"
            >{{ field("lastError", "") }}</span
          >
          <span class="text-xs text-muted-foreground"
            >#{{ connection.priority }}</span
          >
          <span
            v-if="field('globalPriority', '')"
            class="text-xs text-muted-foreground"
            >Auto: {{ field("globalPriority", "") }}</span
          >
          <Badge v-if="oneByOneLabel" :variant="oneByOneVariant">{{
            oneByOneLabel
          }}</Badge>
        </div>
        <div v-if="hasAnyProxy" class="mt-1 flex flex-wrap items-center gap-2">
          <span
            class="max-w-full truncate text-[11px] text-muted-foreground sm:max-w-[420px]"
            :title="proxyDisplayText"
            >{{ proxyDisplayText }}</span
          >
          <code
            v-if="maskedProxyUrl"
            class="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-muted-foreground dark:bg-white/5 sm:max-w-[260px]"
            >{{ maskedProxyUrl }}</code
          >
          <span
            v-if="noProxyText"
            class="max-w-full truncate text-[11px] text-muted-foreground sm:max-w-[320px]"
            :title="noProxyText"
            >no_proxy: {{ noProxyText }}</span
          >
        </div>
      </div>
    </div>
    <div
      class="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end"
    >
      <div class="grid flex-1 grid-cols-3 gap-1 sm:flex sm:flex-none">
        <div v-if="proxyPools.length" ref="proxyDropdownRef" class="relative">
          <button
            class="flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            :class="
              hasAnyProxy
                ? 'text-primary'
                : 'text-muted-foreground hover:text-primary'
            "
            :disabled="updatingProxy"
            @click="showProxyDropdown = !showProxyDropdown"
          >
            <span class="material-symbols-outlined text-[18px]">{{
              updatingProxy ? "progress_activity" : "lan"
            }}</span>
            <span class="text-[10px] leading-tight">Proxy</span>
          </button>
          <div
            v-if="showProxyDropdown"
            class="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-popover py-1 shadow-lg"
          >
            <button
              class="w-full px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
              :class="!boundProxyPoolId ? 'font-medium text-primary' : ''"
              @click="selectProxy('__none__')"
            >
              None
            </button>
            <button
              v-for="pool in proxyPools"
              :key="pool.id"
              class="w-full px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
              :class="
                boundProxyPoolId === pool.id ? 'font-medium text-primary' : ''
              "
              @click="selectProxy(pool.id)"
            >
              {{ pool.name }}
            </button>
          </div>
        </div>
        <button
          v-if="autoPing"
          class="flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          :class="
            autoPing.on
              ? 'text-primary'
              : 'text-muted-foreground hover:text-primary'
          "
          :title="autoPingTooltip"
          @click="emit('autoPing', !autoPing.on)"
        >
          <span class="material-symbols-outlined text-[18px]">bolt</span>
          <span class="text-[10px] leading-tight">{{ autoPingLabel }}</span>
        </button>
        <button
          class="flex flex-col items-center rounded px-2 py-1 text-muted-foreground hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
          :class="{
            'animate-pulse': testing,
            'cursor-not-allowed opacity-50': connection.isActive === false,
          }"
          :disabled="testing || connection.isActive === false"
          :title="testing ? 'Testing connection' : 'Test connection'"
          :aria-label="testing ? 'Testing connection' : 'Test connection'"
          @click="testConnection"
        >
          <span class="material-symbols-outlined text-[18px]">{{
            testing ? "progress_activity" : "sync"
          }}</span>
          <span class="text-[10px] leading-tight">{{
            testing ? "Testing..." : "Test"
          }}</span>
        </button>
        <button
          class="flex flex-col items-center rounded px-2 py-1 text-muted-foreground hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
          @click="emit('edit')"
        >
          <span class="material-symbols-outlined text-[18px]">edit</span>
          <span class="text-[10px] leading-tight">Edit</span>
        </button>
        <button
          class="flex flex-col items-center rounded px-2 py-1 text-red-500 hover:bg-red-500/10"
          @click="emit('delete')"
        >
          <span class="material-symbols-outlined text-[18px]">delete</span>
          <span class="text-[10px] leading-tight">Delete</span>
        </button>
      </div>
      <Toggle
        size="sm"
        :checked="connection.isActive ?? true"
        :title="
          (connection.isActive ?? true)
            ? 'Disable connection'
            : 'Enable connection'
        "
        @change="(value: boolean) => emit('toggleActive', value)"
      />
    </div>
  </div>
</template>
