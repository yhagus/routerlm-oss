<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ProviderConnection, ProxyPool } from "@/types/api";
import type { NormalizedQuotaRow } from "@/lib/quota";
import { api } from "@/lib/api";
import Badge from "@/components/ui/badge.vue";
import Toggle from "@/components/ui/toggle.vue";
import CooldownTimer from "@/components/providers/CooldownTimer.vue";
import QuotaTable from "@/components/usage/QuotaTable.vue";

type TestState = {
  state: "queued" | "testing" | "success" | "failed" | "cancelled";
  error?: string | null;
} | null;
type QuotaState = {
  loading?: boolean;
  error?: string | null;
  message?: string | null;
  quotas?: NormalizedQuotaRow[];
} | null;

const props = defineProps<{
  connection: ProviderConnection;
  proxyPools: ProxyPool[];
  isOauth: boolean;
  isFirst: boolean;
  isLast: boolean;
  selected: boolean;
  quota?: QuotaState;
  oneByOneStatus?: TestState;
  autoPing?: { on: boolean; provider: string } | null;
  codexResetCreditCount?: number;
  codexResetting?: boolean;
}>();
const emit = defineEmits<{
  toggleSelect: [];
  moveUp: [];
  moveDown: [];
  toggleActive: [isActive: boolean];
  updateProxy: [poolId: string | null];
  edit: [];
  delete: [];
  autoPing: [on: boolean];
  tested: [result: { ok: boolean; error?: string }];
  refreshQuota: [];
  codexResetLimit: [];
  codexViewCredits: [];
}>();

const AUTO_PING_SETTINGS_KEYS: Record<string, string> = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

const menuOpen = ref(false);
const showProxyMenu = ref(false);
const updatingProxy = ref(false);
const testing = ref(false);
const cardRef = ref<HTMLElement | null>(null);
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

const showAutoPing = computed(
  () =>
    Boolean(props.autoPing) &&
    AUTO_PING_SETTINGS_KEYS[
      rowAuthType.value === "oauth" ? props.autoPing!.provider : ""
    ] !== undefined &&
    props.connection.authType === "oauth",
);
const isCodex = computed(() => props.connection.provider === "codex");

function onDocClick(event: MouseEvent) {
  if (cardRef.value && !cardRef.value.contains(event.target as Node)) {
    menuOpen.value = false;
    showProxyMenu.value = false;
  }
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
    showProxyMenu.value = false;
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
    ref="cardRef"
    class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-black/10 bg-card transition-colors dark:border-white/10"
    :class="{
      'opacity-60': connection.isActive === false,
      'ring-2 ring-primary/60': selected,
    }"
  >
    <!-- Header -->
    <div class="border-b border-black/10 dark:border-white/10">
      <div class="flex items-center gap-2 px-2.5 py-2">
        <input
          type="checkbox"
          :checked="selected"
          class="size-4 shrink-0"
          aria-label="Select connection"
          @change="emit('toggleSelect')"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium leading-tight">
            {{ displayName }}
          </p>
          <p
            v-if="secondaryDisplayName"
            class="truncate text-xs leading-tight text-muted-foreground"
          >
            {{ secondaryDisplayName }}
          </p>
        </div>

        <!-- Actions menu -->
        <div class="relative">
          <button
            type="button"
            aria-label="Connection actions"
            aria-haspopup="menu"
            class="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
            @click="
              menuOpen = !menuOpen;
              showProxyMenu = false;
            "
          >
            <span class="material-symbols-outlined text-[16px]">more_vert</span>
          </button>
          <template v-if="menuOpen">
            <div
              class="absolute right-0 z-40 mt-1 w-48 overflow-hidden rounded-xl border border-black/10 bg-background/95 p-1 shadow-xl backdrop-blur dark:border-white/10"
            >
              <button
                type="button"
                :disabled="isFirst"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                @click="
                  menuOpen = false;
                  emit('moveUp');
                "
              >
                <span class="material-symbols-outlined text-[14px]"
                  >arrow_upward</span
                >
                <span>Move up</span>
              </button>
              <button
                type="button"
                :disabled="isLast"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                @click="
                  menuOpen = false;
                  emit('moveDown');
                "
              >
                <span class="material-symbols-outlined text-[14px]"
                  >arrow_downward</span
                >
                <span>Move down</span>
              </button>
              <div
                class="mx-2 my-0.5 border-t border-black/5 dark:border-white/5"
              />
              <button
                type="button"
                :disabled="testing || connection.isActive === false"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                @click="
                  menuOpen = false;
                  testConnection();
                "
              >
                <span
                  class="material-symbols-outlined text-[14px]"
                  :class="testing && 'animate-spin'"
                  >{{ testing ? "progress_activity" : "sync" }}</span
                >
                <span>{{ testing ? "Testing..." : "Test connection" }}</span>
              </button>
              <button
                type="button"
                :disabled="quota?.loading"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                @click="
                  menuOpen = false;
                  emit('refreshQuota');
                "
              >
                <span
                  class="material-symbols-outlined text-[14px]"
                  :class="quota?.loading && 'animate-spin'"
                  >refresh</span
                >
                <span>Refresh quota</span>
              </button>
              <template v-if="isCodex">
                <button
                  type="button"
                  :disabled="
                    (codexResetCreditCount ?? 0) <= 0 ||
                    quota?.loading ||
                    codexResetting
                  "
                  class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                  @click="
                    menuOpen = false;
                    emit('codexResetLimit');
                  "
                >
                  <span
                    class="material-symbols-outlined text-[14px]"
                    :class="codexResetting && 'animate-spin'"
                    >{{
                      codexResetting ? "progress_activity" : "restart_alt"
                    }}</span
                  >
                  <span>Reset limit</span>
                  <span
                    class="ml-auto text-[10px] tabular-nums text-muted-foreground"
                    >{{ codexResetCreditCount ?? 0 }}</span
                  >
                </button>
                <button
                  type="button"
                  :disabled="quota?.loading"
                  class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                  @click="
                    menuOpen = false;
                    emit('codexViewCredits');
                  "
                >
                  <span class="material-symbols-outlined text-[14px]"
                    >schedule</span
                  >
                  <span>Reset credits</span>
                </button>
              </template>
              <button
                v-if="showAutoPing"
                type="button"
                :title="autoPingTooltip"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                @click="
                  menuOpen = false;
                  emit('autoPing', !(autoPing?.on === true));
                "
              >
                <span
                  class="material-symbols-outlined text-[14px]"
                  :class="autoPing?.on && 'text-primary'"
                  >bolt</span
                >
                <span>{{
                  autoPing?.on ? `${autoPingLabel}: on` : `${autoPingLabel}: off`
                }}</span>
              </button>
              <div v-if="proxyPools.length" class="relative">
                <button
                  type="button"
                  :disabled="updatingProxy"
                  class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                  @click="showProxyMenu = !showProxyMenu"
                >
                  <span
                    class="material-symbols-outlined text-[14px]"
                    :class="[
                      updatingProxy && 'animate-spin',
                      hasAnyProxy && 'text-primary',
                    ]"
                    >lan</span
                  >
                  <span>Proxy</span>
                  <span class="material-symbols-outlined ml-auto text-[14px]"
                    >chevron_right</span
                  >
                </button>
                <div
                  v-if="showProxyMenu"
                  class="mt-0.5 max-h-52 overflow-y-auto rounded-lg border border-black/10 bg-background/95 p-1 dark:border-white/10"
                >
                  <button
                    type="button"
                    class="w-full rounded px-2.5 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/5"
                    :class="!boundProxyPoolId ? 'font-medium text-primary' : ''"
                    @click="
                      menuOpen = false;
                      selectProxy('__none__');
                    "
                  >
                    None
                  </button>
                  <button
                    v-for="pool in proxyPools"
                    :key="pool.id"
                    type="button"
                    class="w-full truncate rounded px-2.5 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/5"
                    :class="
                      boundProxyPoolId === pool.id
                        ? 'font-medium text-primary'
                        : ''
                    "
                    @click="
                      menuOpen = false;
                      selectProxy(pool.id);
                    "
                  >
                    {{ pool.name }}
                  </button>
                </div>
              </div>
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                @click="
                  menuOpen = false;
                  emit('edit');
                "
              >
                <span class="material-symbols-outlined text-[14px]">edit</span>
                <span>Edit</span>
              </button>
              <div
                class="mx-2 my-0.5 border-t border-black/5 dark:border-white/5"
              />
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10"
                @click="
                  menuOpen = false;
                  emit('delete');
                "
              >
                <span class="material-symbols-outlined text-[14px]"
                  >delete</span
                >
                <span>Delete</span>
              </button>
            </div>
          </template>
        </div>

        <div
          :title="
            (connection.isActive ?? true)
              ? 'Disable connection'
              : 'Enable connection'
          "
        >
          <Toggle
            size="sm"
            :checked="connection.isActive ?? true"
            @change="(value: boolean) => emit('toggleActive', value)"
          />
        </div>
      </div>

      <!-- Badges -->
      <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 px-2.5 pb-2">
        <Badge :variant="statusVariant" dot>{{
          connection.isActive === false
            ? "disabled"
            : effectiveStatus || "Unknown"
        }}</Badge>
        <Badge variant="outline">{{ authLabel }}</Badge>
        <Badge v-if="String(field('group', '')).trim()" variant="info">{{
          String(field("group", "")).trim()
        }}</Badge>
        <Badge
          v-if="hasAnyProxy"
          :variant="proxyBadgeVariant"
          :title="proxyDisplayText"
          >Proxy</Badge
        >
        <CooldownTimer
          v-if="isCooldown && connection.isActive !== false"
          :until="modelLockUntil"
        />
        <Badge
          v-if="oneByOneLabel"
          :variant="oneByOneVariant"
          class="max-w-full truncate"
          >{{ oneByOneLabel }}</Badge
        >
      </div>
      <p
        v-if="field('lastError', '') && connection.isActive !== false"
        class="truncate px-2.5 pb-2 text-[11px] text-red-500"
        :title="String(field('lastError', ''))"
      >
        {{ field("lastError", "") }}
      </p>
    </div>

    <!-- Quota body (pinned to card bottom) -->
    <div class="mt-auto px-2 py-1.5">
      <div v-if="quota?.loading" class="py-3 text-center text-muted-foreground">
        <span class="material-symbols-outlined animate-spin text-[20px]"
          >progress_activity</span
        >
      </div>
      <div v-else-if="quota?.error" class="py-3 text-center">
        <span class="material-symbols-outlined text-[20px] text-red-500"
          >error</span
        >
        <p class="mt-1 text-[10px] text-muted-foreground">{{ quota.error }}</p>
      </div>
      <div v-else-if="quota?.message" class="py-3 text-center">
        <p class="text-[10px] text-muted-foreground">{{ quota.message }}</p>
      </div>
      <QuotaTable
        v-else-if="quota?.quotas?.length"
        :quotas="quota.quotas"
        compact
        sort-mode="default"
      />
      <div v-else class="py-3 text-center">
        <p class="text-[10px] text-muted-foreground">No quota data</p>
      </div>
    </div>
  </div>
</template>
