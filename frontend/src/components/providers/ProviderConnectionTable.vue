<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ProviderConnection, ProxyPool } from "@/types/api";
import type { NormalizedQuotaRow, QuotaEntry } from "@/lib/quota";
import {
  formatBalance,
  formatResetTime,
  getRemainingPercentage,
} from "@/lib/quota";
import { api } from "@/lib/api";
import Badge from "@/components/ui/badge.vue";
import Toggle from "@/components/ui/toggle.vue";
import CooldownTimer from "@/components/providers/CooldownTimer.vue";

type QuotaColumn = { key: string; label: string };
type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "destructive"
  | "success"
  | "warning"
  | "info"
  | "error";

const props = defineProps<{
  connections: ProviderConnection[];
  providerId: string;
  isOauth: boolean;
  proxyPools: ProxyPool[];
  selectedIds: string[];
  allSelected: boolean;
  firstId: string | null;
  lastId: string | null;
  quotaColumns: QuotaColumn[];
  quotaData: Record<string, QuotaEntry>;
  quotaLoading: Record<string, boolean>;
  quotaErrors: Record<string, string | null>;
  oneByOneResults: Record<
    string,
    {
      state: "queued" | "testing" | "success" | "failed" | "cancelled";
      error?: string | null;
    }
  >;
  autoPingKey: string;
  autoPingConfig: { enabled?: boolean; connections?: Record<string, boolean> };
  codexCreditCounts: Record<string, number>;
  codexResettingId: string | null;
  autoclawTasks: Record<
    string,
    Array<{ id: string; name: string; claimed: boolean; rewardPoints: number }>
  >;
  autoclawClaiming: Record<string, Record<string, boolean>>;
  autoclawLoaded: Record<string, boolean>;
  codebuddyProbed: Record<
    string,
    {
      probed: boolean;
      checkin: {
        state: string;
        credit: number | null;
        streakDays: number | null;
        error: string | null;
      } | null;
      reported: boolean;
    }
  >;
}>();

const emit = defineEmits<{
  toggleSelect: [connectionId: string];
  toggleSelectAll: [];
  moveUp: [connectionId: string];
  moveDown: [connectionId: string];
  toggleActive: [connectionId: string, isActive: boolean];
  updateProxy: [connectionId: string, poolId: string | null];
  edit: [connection: ProviderConnection];
  delete: [connectionId: string];
  autoPing: [connectionId: string, on: boolean];
  refreshQuota: [connectionId: string];
  codexResetLimit: [connection: ProviderConnection];
  codexViewCredits: [connection: ProviderConnection];
  tested: [connection: ProviderConnection];
  claim: [connectionId: string, claimId: string];
  inspiration: [connectionId: string];
  probeHistory: [connectionId: string];
  bindInvite: [connectionId: string];
  reportTask: [connectionId: string];
  clearCooldown: [connectionId: string];
  account: [connectionId: string];
}>();

const AUTO_PING_SETTINGS_KEYS: Record<string, string> = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
  autoclaw: "autoclawAutoClaim",
  "codebuddy-intl-cli": "codebuddyIntlCliDailyProbe",
};
const MENU_WIDTH = 192;

const menu = ref<{
  connectionId: string;
  left: number;
  top: number;
  maxHeight: number;
} | null>(null);
const proxyMenuOpen = ref(false);
const testingIds = ref<Record<string, boolean>>({});
const nowMs = ref(Date.now());
let tick: number | undefined;

function field<T>(
  connection: ProviderConnection,
  name: string,
  fallback: T,
): T {
  const value =
    (connection as unknown as Record<string, unknown>)[name] ??
    (connection.data as Record<string, unknown> | undefined)?.[name];
  return (value === undefined || value === null ? fallback : value) as T;
}

function openMenu(event: MouseEvent, connection: ProviderConnection) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
  );
  const below = rect.bottom + 4;
  const maxHeight = Math.max(180, window.innerHeight - below - 8);
  menu.value = { connectionId: connection.id, left, top: below, maxHeight };
  proxyMenuOpen.value = false;
}

function closeMenu() {
  menu.value = null;
  proxyMenuOpen.value = false;
}

function menuConnection(): ProviderConnection | null {
  return menu.value
    ? props.connections.find((c) => c.id === menu.value!.connectionId) || null
    : null;
}

function onDocClick(event: MouseEvent) {
  if (!menu.value) return;
  const target = event.target as HTMLElement;
  if (
    target.closest("[data-connection-menu]") ||
    target.closest("[data-connection-menu-trigger]")
  )
    return;
  closeMenu();
}

function onWindowScroll() {
  closeMenu();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  window.addEventListener("scroll", onWindowScroll, true);
  window.addEventListener("resize", onWindowScroll);
  tick = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
  window.removeEventListener("scroll", onWindowScroll, true);
  window.removeEventListener("resize", onWindowScroll);
  if (tick) window.clearInterval(tick);
});

async function testConnection(connection: ProviderConnection) {
  if (testingIds.value[connection.id] || connection.isActive === false) return;
  testingIds.value = { ...testingIds.value, [connection.id]: true };
  try {
    await api.providers.test(connection.id);
    emit("tested", connection);
  } finally {
    testingIds.value = { ...testingIds.value, [connection.id]: false };
    closeMenu();
  }
}

// Per-row derived state ------------------------------------------------------------

const rows = computed(() =>
  props.connections.map((connection) => {
    const authType = String(
      connection.authType || (props.isOauth ? "oauth" : "apikey"),
    );
    const isOAuth = authType === "oauth";
    const isCookie = authType === "cookie";
    const authLabel = isOAuth ? "OAuth" : isCookie ? "Cookie" : "API Key";

    const name = connection.name?.trim();
    const email = connection.email?.trim();
    const display = String(field(connection, "displayName", "") || "").trim();
    const displayName =
      name ||
      email ||
      display ||
      (isOAuth ? "OAuth Account" : isCookie ? "Cookie Account" : "API Key");
    let secondary: string | null = null;
    if (name && email && name !== email) secondary = email;
    else if (name && display && name !== display) secondary = display;

    const source = {
      ...(connection as unknown as Record<string, unknown>),
      ...((connection.data as Record<string, unknown> | undefined) || {}),
    };
    const modelLockUntil =
      Object.entries(source)
        .filter(([key, value]) => key.startsWith("modelLock_") && value)
        .map(([, value]) => String(value))
        .filter((value) => new Date(value).getTime() > nowMs.value)
        .sort()[0] || null;
    const isCooldown = Boolean(modelLockUntil);
    const isRestricted = Boolean(field(connection, "codebuddyRestrictedAt", ""));

    const oneByOne = props.oneByOneResults[connection.id] || null;
    let oneByOneVariant: BadgeVariant = "secondary";
    let oneByOneLabel: string | null = null;
    if (oneByOne) {
      if (oneByOne.state === "success") oneByOneVariant = "success";
      else if (oneByOne.state === "failed") oneByOneVariant = "destructive";
      else if (oneByOne.state === "testing") oneByOneVariant = "default";
      oneByOneLabel =
        oneByOne.state === "queued"
          ? "queued"
          : oneByOne.state === "testing"
            ? "testing"
            : oneByOne.state === "success"
              ? "success"
              : oneByOne.state === "cancelled"
                ? "cancelled"
                : oneByOne.error
                  ? `failed: ${oneByOne.error}`
                  : "failed";
    }

    const boundProxyPoolId =
      field<string | null>(connection, "proxyPoolId", null) || null;
    const hasLegacyProxy =
      field(connection, "connectionProxyEnabled", false as boolean) === true &&
      Boolean(field(connection, "connectionProxyUrl", ""));
    const hasAnyProxy = Boolean(boundProxyPoolId) || hasLegacyProxy;
    const ownMaxInFlight = Number(field(connection, "maxInFlight", 0));
    const maxInFlight = ownMaxInFlight >= 1 ? Math.floor(ownMaxInFlight) : null;

    const isAutoclawProvider = props.providerId === "autoclaw";
    const autoPing =
      props.autoPingKey && (isOAuth || isAutoclawProvider)
        ? {
            on: props.autoPingConfig.connections?.[connection.id] === true,
            provider: props.providerId,
          }
        : null;
    const showAutoPing =
      Boolean(autoPing) &&
      AUTO_PING_SETTINGS_KEYS[autoPing!.provider] !== undefined &&
      (isOAuth || isAutoclawProvider);

    const quota = props.quotaData[connection.id];
    const quotaNotice =
      props.quotaErrors[connection.id] || quota?.message || null;
    const quotaPlan =
      typeof quota?.plan === "string" && quota.plan.trim()
        ? quota.plan.trim()
        : String(field(connection, "chatgptPlanType", "") || "").trim() || null;

    return {
      connection,
      authLabel,
      displayName,
      secondary,
      group: String(field(connection, "group", "")).trim() || "Ungrouped",
      modelLockUntil,
      isCooldown,
      isRestricted,
      oneByOneVariant,
      oneByOneLabel,
      boundProxyPoolId,
      hasAnyProxy,
      maxInFlight,
      autoPing,
      showAutoPing,
      probed: props.codebuddyProbed?.[connection.id]?.probed === true,
      checkin: props.codebuddyProbed?.[connection.id]?.checkin ?? null,
      inviteBound: field(connection, "inviteBound", false as boolean) === true,
      inviteChain: field(connection, "inviteChain", null as { step?: string; status?: string; error?: string | null } | null),
      plan: quotaPlan,
      quota,
      quotaNotice,
      isLoading: props.quotaLoading[connection.id] === true,
      isCodex: connection.provider === "codex",
      testing: testingIds.value[connection.id] === true,
    };
  }),
);

const menuRow = computed(() =>
  menu.value
    ? rows.value.find(
        (row) => row.connection.id === menu.value!.connectionId,
      ) || null
    : null,
);

// Quota cells ----------------------------------------------------------------------

function quotaFor(
  connectionId: string,
  column: QuotaColumn,
): NormalizedQuotaRow | null {
  const quotas = props.quotaData[connectionId]?.quotas;
  if (!quotas) return null;
  return (
    quotas.find(
      (quota) => String(quota.modelKey || quota.name) === column.key,
    ) || null
  );
}

function claimsFor(
  connectionId: string,
): Array<{ id: string; name: string; claimed: boolean; rewardPoints: number }> {
  return props.autoclawTasks[connectionId] || [];
}

function isClaiming(connectionId: string, claimId: string): boolean {
  return props.autoclawClaiming[connectionId]?.[claimId] === true;
}

function isAutoclawLoaded(connectionId: string): boolean {
  return props.autoclawLoaded[connectionId] === true;
}

function autoPingLabel(provider: string | undefined): string {
  if (provider === "autoclaw") return "Auto-claim";
  if (provider === "codebuddy-intl-cli") return "Daily probe";
  return "Auto-ping";
}

function claimButtonTitle(claim: {
  id: string;
  claimed: boolean;
  rewardPoints: number;
}): string {
  if (claim.id === "inspiration_center")
    return "View and claim inspiration cards";
  return claimTooltip(claim);
}

function claimTooltip(claim: {
  claimed: boolean;
  rewardPoints: number;
}): string {
  const reward = claim.rewardPoints > 0 ? ` (+${claim.rewardPoints} pts)` : "";
  return claim.claimed ? `Already claimed${reward}` : `Claim reward${reward}`;
}

function colors(remaining: number) {
  if (remaining > 70)
    return {
      text: "text-green-600 dark:text-green-400",
      bg: "bg-green-500",
      bgLight: "bg-green-500/10",
    };
  if (remaining >= 30)
    return {
      text: "text-yellow-600 dark:text-yellow-400",
      bg: "bg-yellow-500",
      bgLight: "bg-yellow-500/10",
    };
  return {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500",
    bgLight: "bg-red-500/10",
  };
}

function quotaRemaining(quota: NormalizedQuotaRow) {
  return getRemainingPercentage(quota);
}

function quotaCellTitle(quota: NormalizedQuotaRow) {
  const reset = quota.resetAt ? new Date(quota.resetAt).toLocaleString() : null;
  const remaining =
    quota.creditBalance !== undefined
      ? `${formatBalance(quota.creditBalance)} remaining (${quotaRemaining(quota)}%)`
      : `${quotaRemaining(quota)}% remaining`;
  return reset
    ? `${quota.name} — ${remaining}; resets ${reset}`
    : `${quota.name} — ${remaining}`;
}

function formatRegistered(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
</script>

<template>
  <div class="overflow-x-auto rounded-lg border">
    <table class="w-full border-separate border-spacing-0 text-left text-xs">
      <thead>
        <tr class="text-[10px] text-muted-foreground">
          <th
            class="font-semibold sticky left-0 z-30 w-8 border-b bg-muted px-3 py-2.5"
          >
            <input
              type="checkbox"
              :checked="allSelected"
              class="size-3.5"
              aria-label="Select all connections"
              @change="emit('toggleSelectAll')"
            />
          </th>
          <th
            class="font-semibold min-w-[12rem] border-b bg-muted/60 px-3 py-2.5"
          >
            Account
          </th>
          <th
            class="font-semibold min-w-[5rem] border-b bg-muted/60 px-3 py-2.5 text-center"
          >
            Group
          </th>
          <th
            class="font-semibold min-w-[5rem] border-b bg-muted/60 px-3 py-2.5 text-center"
          >
            Plan
          </th>
          <th
            class="font-semibold min-w-[5.5rem] border-b bg-muted/60 px-3 py-2.5 text-center"
          >
            Registered
          </th>
          <th
            class="font-semibold w-12 border-b bg-muted/60 px-3 py-2.5 text-center"
          >
            On
          </th>
          <th
            v-for="column in quotaColumns"
            :key="column.key"
            class="font-semibold min-w-[7.5rem] border-b bg-muted/60 px-3 py-2.5 text-center"
          >
            <span
              class="mx-auto block max-w-[9rem] truncate"
              :title="column.label"
              >{{ column.label }}</span
            >
          </th>
          <th
            class="font-semibold sticky right-0 z-30 w-9 border-b border-l bg-muted px-3 py-2.5"
          />
        </tr>
      </thead>
      <tbody>
        <tr v-if="!rows.length">
          <td
            :colspan="7 + quotaColumns.length"
            class="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            No connections match the current group filter.
          </td>
        </tr>
        <tr
          v-for="row in rows"
          :key="row.connection.id"
          class="transition-colors hover:bg-muted/50"
          :class="{ 'opacity-60': row.connection.isActive === false }"
        >
          <!-- Checkbox (sticky left) -->
          <td
            class="sticky left-0 z-10 border-b border-border/60 bg-card px-2.25 py-1.5 align-middle"
          >
            <input
              type="checkbox"
              :checked="selectedIds.includes(row.connection.id)"
              class="size-3.5"
              :aria-label="`Select ${row.displayName}`"
              @change="emit('toggleSelect', row.connection.id)"
            />
          </td>

          <!-- Account -->
          <td
            class="min-w-[12rem] border-b border-border/60 px-2.25 py-1.5 align-middle"
          >
            <div class="flex min-w-0 flex-col gap-0.5">
              <div class="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  class="min-w-0 truncate text-left text-xs font-medium leading-tight text-primary hover:underline"
                  :title="`View usage for ${row.displayName}`"
                  @click="emit('account', row.connection.id)"
                >
                  {{ row.displayName }}
                </button>
                <Badge variant="outline" class="shrink-0">{{
                  row.authLabel
                }}</Badge>
                <Badge
                  v-if="row.hasAnyProxy"
                  variant="secondary"
                  class="shrink-0"
                  title="Proxy bound"
                  >Proxy</Badge
                >
                <Badge
                  v-if="row.maxInFlight"
                  variant="secondary"
                  class="shrink-0"
                  :title="`Max ${row.maxInFlight} concurrent request(s)`"
                  >≤{{ row.maxInFlight }}</Badge
                >
                <CooldownTimer
                  v-if="row.isCooldown && row.connection.isActive !== false"
                  :until="row.modelLockUntil"
                />
                <Badge
                  v-if="row.isRestricted && row.connection.isActive !== false"
                  variant="destructive"
                  class="shrink-0"
                  title="CodeBuddy restricted this account. It is skipped for chat; its token is still refreshed."
                  >Restricted</Badge
                >
                <Badge
                  v-if="row.oneByOneLabel"
                  :variant="row.oneByOneVariant"
                  class="max-w-[8rem] shrink-0 truncate"
                  >{{ row.oneByOneLabel }}</Badge
                >
                <span
                  v-if="
                    field(row.connection, 'lastError', '') &&
                    row.connection.isActive !== false
                  "
                  class="material-symbols-outlined shrink-0 cursor-help text-[13px] text-red-500"
                  :title="String(field(row.connection, 'lastError', ''))"
                  >error</span
                >
              </div>
              <p
                v-if="
                  field(row.connection, 'lastError', '') &&
                  row.connection.isActive !== false
                "
                class="max-w-full truncate text-[11px] leading-tight text-red-500"
                :title="String(field(row.connection, 'lastError', ''))"
              >
                {{ field(row.connection, "lastError", "") }}
              </p>
              <p
                v-if="row.secondary"
                class="truncate text-[11px] leading-tight text-muted-foreground"
              >
                {{ row.secondary }}
              </p>
              <div
                v-if="providerId === 'autoclaw'"
                class="mt-0.5 flex items-center gap-1.5"
              >
                <template v-if="isAutoclawLoaded(row.connection.id)">
                  <button
                    v-for="claim in claimsFor(row.connection.id)"
                    :key="claim.id"
                    type="button"
                    class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    :class="
                      claim.claimed
                        ? 'border-input text-muted-foreground'
                        : 'border-input text-primary hover:bg-primary/10'
                    "
                    :disabled="
                      claim.id === 'inspiration_center'
                        ? false
                        : isClaiming(row.connection.id, claim.id) ||
                          claim.claimed
                    "
                    :title="claimButtonTitle(claim)"
                    @click="
                      claim.id === 'inspiration_center'
                        ? emit('inspiration', row.connection.id)
                        : emit('claim', row.connection.id, claim.id)
                    "
                  >
                    <span
                      v-if="isClaiming(row.connection.id, claim.id)"
                      class="material-symbols-outlined inline-block animate-spin text-[12px]"
                      >progress_activity</span
                    >
                    <span>{{
                      isClaiming(row.connection.id, claim.id)
                        ? "Claiming…"
                        : claim.name
                    }}</span>
                  </button>
                </template>
                <span
                  v-else
                  class="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                >
                  <span
                    class="material-symbols-outlined inline-block animate-spin text-[12px]"
                    >progress_activity</span
                  >
                  Loading…
                </span>
              </div>
            </div>
          </td>

          <!-- Group -->
          <td
            class="min-w-[5rem] border-b border-border/60 px-2.25 py-1.5 text-center align-middle"
          >
            <span v-if="row.group !== 'Ungrouped'" class="text-[11px]">{{
              row.group
            }}</span>
            <span v-else class="text-[11px] text-muted-foreground">—</span>
          </td>

          <!-- Plan -->
          <td
            class="min-w-[5rem] border-b border-border/60 px-2.25 py-1.5 text-center align-middle"
          >
            <span v-if="row.plan" class="text-[11px]">{{ row.plan }}</span>
            <span v-else class="text-[11px] text-muted-foreground">—</span>
          </td>

          <!-- Registered -->
          <td
            class="min-w-[5.5rem] border-b border-border/60 px-2.25 py-1.5 text-center align-middle"
          >
            <span
              class="whitespace-nowrap text-[11px] text-muted-foreground"
              :title="new Date(row.connection.createdAt).toLocaleString()"
              >{{ formatRegistered(row.connection.createdAt) }}</span
            >
          </td>

          <!-- On/Off -->
          <td
            class="w-12 border-b border-border/60 px-2.25 py-1.5 text-center align-middle"
          >
            <div class="flex justify-center">
              <Toggle
                size="sm"
                :checked="row.connection.isActive ?? true"
                @change="
                  (value: boolean) =>
                    emit('toggleActive', row.connection.id, value)
                "
              />
            </div>
          </td>

          <!-- Quota columns -->
          <td
            v-if="row.isLoading && quotaColumns.length"
            :colspan="quotaColumns.length"
            class="border-b border-border/60 px-2.25 py-1.5 text-center align-middle"
          >
            <span
              class="material-symbols-outlined inline-block animate-spin align-middle text-[15px] text-muted-foreground"
              >progress_activity</span
            >
          </td>
          <td
            v-else-if="row.quotaNotice && quotaColumns.length"
            :colspan="quotaColumns.length"
            class="border-b border-border/60 px-2.25 py-1.5 text-center align-middle"
          >
            <span class="text-[10px] italic text-muted-foreground">{{
              row.quotaNotice
            }}</span>
          </td>
          <template v-else-if="quotaColumns.length">
            <td
              v-for="column in quotaColumns"
              :key="column.key"
              class="min-w-[7.5rem] border-b border-border/60 px-2.25 py-1.5 text-center align-middle"
            >
              <template v-if="quotaFor(row.connection.id, column)">
                <div
                  v-if="
                    quotaFor(row.connection.id, column)!.balance !== undefined
                  "
                  class="mx-auto w-[6.5rem]"
                >
                  <div
                    class="flex items-center justify-center gap-1 text-[10px] leading-tight"
                    :title="
                      quotaCellTitle(quotaFor(row.connection.id, column)!)
                    "
                  >
                    <span class="font-medium text-success">{{
                      formatBalance(
                        quotaFor(row.connection.id, column)!.balance!,
                      )
                    }}</span>
                    <span class="text-muted-foreground">{{
                      quotaFor(row.connection.id, column)!.unit || "points"
                    }}</span>
                  </div>
                </div>
                <div v-else class="mx-auto w-[6.5rem]">
                  <div
                    class="flex items-center justify-between gap-1 text-[10px] leading-tight"
                  >
                    <span
                      class="truncate text-muted-foreground"
                      :title="
                        quotaCellTitle(quotaFor(row.connection.id, column)!)
                      "
                    >
                      {{
                        formatResetTime(
                          quotaFor(row.connection.id, column)!.resetAt,
                        ) !== "-"
                          ? formatResetTime(
                              quotaFor(row.connection.id, column)!.resetAt,
                            )
                          : "—"
                      }}
                    </span>
                    <span
                      class="shrink-0 font-medium"
                      :class="
                        colors(
                          quotaRemaining(quotaFor(row.connection.id, column)!),
                        ).text
                      "
                      >{{
                        quotaFor(row.connection.id, column)!.creditBalance !==
                        undefined
                          ? formatBalance(
                              quotaFor(row.connection.id, column)!
                                .creditBalance!,
                            )
                          : `${quotaRemaining(quotaFor(row.connection.id, column)!)}%`
                      }}</span
                    >
                  </div>
                  <div
                    class="mt-0.5 h-1 overflow-hidden rounded-full border"
                    :class="[
                      colors(
                        quotaRemaining(quotaFor(row.connection.id, column)!),
                      ).bgLight,
                      quotaRemaining(quotaFor(row.connection.id, column)!) === 0
                        ? 'border-border'
                        : 'border-transparent',
                    ]"
                  >
                    <div
                      class="h-full transition-all duration-300"
                      :class="
                        colors(
                          quotaRemaining(quotaFor(row.connection.id, column)!),
                        ).bg
                      "
                      :style="{
                        width: `${Math.min(quotaRemaining(quotaFor(row.connection.id, column)!), 100)}%`,
                      }"
                    />
                  </div>
                </div>
              </template>
              <span v-else class="text-[11px] text-muted-foreground">—</span>
            </td>
          </template>

          <!-- Actions (sticky right) -->
          <td
            class="sticky right-0 z-10 border-b border-l border-border/60 bg-card px-2.25 py-1.5 align-middle"
          >
            <button
              type="button"
              aria-label="Connection actions"
              aria-haspopup="menu"
              data-connection-menu-trigger
              class="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              @click.stop="openMenu($event, row.connection)"
            >
              <span class="material-symbols-outlined text-[16px]"
                >more_vert</span
              >
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Floating actions menu -->
    <Teleport to="body">
      <div
        v-if="menu && menuRow"
        data-connection-menu
        class="fixed z-50 w-48 overflow-y-auto rounded-xl border border-border bg-background/95 p-1 shadow-xl backdrop-blur"
        :style="{
          left: `${menu.left}px`,
          top: `${menu.top}px`,
          maxHeight: `${menu.maxHeight}px`,
        }"
      >
        <button
          type="button"
          :disabled="menuRow.connection.id === firstId"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40"
          @click="
            emit('moveUp', menuRow.connection.id);
            closeMenu();
          "
        >
          <span class="material-symbols-outlined text-[14px]"
            >arrow_upward</span
          >
          <span>Move up</span>
        </button>
        <button
          type="button"
          :disabled="menuRow.connection.id === lastId"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40"
          @click="
            emit('moveDown', menuRow.connection.id);
            closeMenu();
          "
        >
          <span class="material-symbols-outlined text-[14px]"
            >arrow_downward</span
          >
          <span>Move down</span>
        </button>
        <div class="mx-2 my-0.5 border-t border-border/60" />
        <button
          type="button"
          :disabled="menuRow.testing || menuRow.connection.isActive === false"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40"
          @click="testConnection(menuRow.connection)"
        >
          <span
            class="material-symbols-outlined text-[14px]"
            :class="menuRow.testing && 'animate-spin'"
            >{{ menuRow.testing ? "progress_activity" : "sync" }}</span
          >
          <span>{{ menuRow.testing ? "Testing..." : "Test connection" }}</span>
        </button>
        <button
          type="button"
          :disabled="menuRow.isLoading"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40"
          @click="
            emit('refreshQuota', menuRow.connection.id);
            closeMenu();
          "
        >
          <span
            class="material-symbols-outlined text-[14px]"
            :class="menuRow.isLoading && 'animate-spin'"
            >refresh</span
          >
          <span>Refresh quota</span>
        </button>
        <template v-if="menuRow.isCodex">
          <button
            type="button"
            :disabled="
              (codexCreditCounts[menuRow.connection.id] ?? 0) <= 0 ||
              codexResettingId === menuRow.connection.id
            "
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40"
            @click="
              emit('codexResetLimit', menuRow.connection);
              closeMenu();
            "
          >
            <span
              class="material-symbols-outlined text-[14px]"
              :class="
                codexResettingId === menuRow.connection.id && 'animate-spin'
              "
              >{{
                codexResettingId === menuRow.connection.id
                  ? "progress_activity"
                  : "restart_alt"
              }}</span
            >
            <span>Reset limit</span>
            <span
              class="ml-auto text-[10px] tabular-nums text-muted-foreground"
              >{{ codexCreditCounts[menuRow.connection.id] ?? 0 }}</span
            >
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
            @click="
              emit('codexViewCredits', menuRow.connection);
              closeMenu();
            "
          >
            <span class="material-symbols-outlined text-[14px]">schedule</span>
            <span>Reset credits</span>
          </button>
        </template>
        <button
          v-if="menuRow.isCooldown || menuRow.isRestricted"
          type="button"
          :title="
            menuRow.isRestricted
              ? 'Put the account back into rotation after a successful appeal.'
              : 'Drop the local wait window at once. Spends no reset credit.'
          "
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
          @click="
            emit('clearCooldown', menuRow.connection.id);
            closeMenu();
          "
        >
          <span class="material-symbols-outlined text-[14px]">timer_off</span>
          <span>{{ menuRow.isRestricted ? "Clear restriction" : "Clear wait" }}</span>
        </button>
        <button
          v-if="providerId === 'codebuddy-intl-cli' && !menuRow.inviteBound"
          type="button"
          :title="
            menuRow.inviteChain?.status === 'failed'
              ? `Continue the invite chain from the failed step (${menuRow.inviteChain?.step}). ${menuRow.inviteChain?.error ?? ''}`
              : 'Run web chat, daily probe, then bind a referral invite code on this account.'
          "
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
          @click="
            emit('bindInvite', menuRow.connection.id);
            closeMenu();
          "
        >
          <span class="material-symbols-outlined text-[14px]">{{
            menuRow.inviteChain?.status === 'failed'
              ? 'restart_alt'
              : 'group_add'
          }}</span>
          <span>{{
            menuRow.inviteChain?.status === 'failed'
              ? 'Continue binding'
              : 'Bind invite code'
          }}</span>
        </button>
        <div
          v-if="providerId === 'codebuddy-intl-cli' && menuRow.inviteBound"
          class="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          <span class="material-symbols-outlined text-[14px] text-green-500">check_circle</span>
          <span>Invite code bound</span>
        </div>
        <div
          v-if="
            menuRow.checkin &&
            (menuRow.checkin.state === 'claimed' ||
              menuRow.checkin.state === 'already_claimed')
          "
          class="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          <span class="material-symbols-outlined text-[14px] text-green-500"
            >redeem</span
          >
          <span>
            {{
              menuRow.checkin.state === "claimed"
                ? `+${menuRow.checkin.credit ?? 0} credits`
                : "Already claimed"
            }}
            <template v-if="menuRow.checkin.streakDays !== null">
              (streak {{ menuRow.checkin.streakDays }})</template
            >
          </span>
        </div>
        <button
          v-if="providerId === 'codebuddy-intl-cli'"
          type="button"
          title="View per-day probe history for this account."
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
          @click="
            emit('probeHistory', menuRow.connection.id);
            closeMenu();
          "
        >
          <span class="material-symbols-outlined text-[14px]">history</span>
          <span>Probe history</span>
        </button>
        <button
          v-if="menuRow.showAutoPing"
          type="button"
          :title="
            menuRow.autoPing?.provider === 'codex'
              ? 'Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota.'
              : menuRow.autoPing?.provider === 'autoclaw'
                ? 'Automatically claims the daily check-in reward once per day.'
                : menuRow.autoPing?.provider === 'codebuddy-intl-cli'
                  ? 'Automatically sends one tiny request per day so the account burns credit.'
                  : 'When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.'
          "
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
          @click="
            emit(
              'autoPing',
              menuRow.connection.id,
              !(menuRow.autoPing?.on === true),
            );
            closeMenu();
          "
        >
          <span
            class="material-symbols-outlined text-[14px]"
            :class="menuRow.autoPing?.on && 'text-primary'"
            >bolt</span
          >
          <span>{{
            menuRow.autoPing?.on
              ? `${autoPingLabel(menuRow.autoPing?.provider)}: on`
              : `${autoPingLabel(menuRow.autoPing?.provider)}: off`
          }}</span>
        </button>
        <div v-if="proxyPools.length">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
            @click="proxyMenuOpen = !proxyMenuOpen"
          >
            <span
              class="material-symbols-outlined text-[14px]"
              :class="menuRow.hasAnyProxy && 'text-primary'"
              >lan</span
            >
            <span>Proxy</span>
            <span class="material-symbols-outlined ml-auto text-[14px]">{{
              proxyMenuOpen ? "expand_less" : "expand_more"
            }}</span>
          </button>
          <div
            v-if="proxyMenuOpen"
            class="mt-0.5 max-h-52 overflow-y-auto rounded-lg border border-border bg-background/95 p-1"
          >
            <button
              type="button"
              class="w-full rounded px-2.5 py-1.5 text-left text-xs hover:bg-accent"
              :class="
                !menuRow.boundProxyPoolId ? 'font-medium text-primary' : ''
              "
              @click="
                emit('updateProxy', menuRow.connection.id, null);
                closeMenu();
              "
            >
              None
            </button>
            <button
              v-for="pool in proxyPools"
              :key="pool.id"
              type="button"
              class="w-full truncate rounded px-2.5 py-1.5 text-left text-xs hover:bg-accent"
              :class="
                menuRow.boundProxyPoolId === pool.id
                  ? 'font-medium text-primary'
                  : ''
              "
              :title="pool.name"
              @click="
                emit('updateProxy', menuRow.connection.id, pool.id);
                closeMenu();
              "
            >
              {{ pool.name }}
            </button>
          </div>
        </div>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
          @click="
            emit('edit', menuRow.connection);
            closeMenu();
          "
        >
          <span class="material-symbols-outlined text-[14px]">edit</span>
          <span>Edit</span>
        </button>
        <div class="mx-2 my-0.5 border-t border-border/60" />
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10"
          @click="
            emit('delete', menuRow.connection.id);
            closeMenu();
          "
        >
          <span class="material-symbols-outlined text-[14px]">delete</span>
          <span>Delete</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
