<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import {
  AlertTriangle,
  Check,
  Download,
  Globe,
  LockKeyhole,
  Save,
  Upload,
  X,
} from "lucide-vue-next";
import PageHeader from "@/components/app/PageHeader.vue";
import Card from "@/components/ui/card.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";
import Select from "@/components/ui/select.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import LanguageSwitcher from "@/components/app/LanguageSwitcher.vue";
import { api } from "@/lib/api";
import { useNotificationStore } from "@/stores/notifications";
import { useThemeStore } from "@/stores/theme";

const SECTION_IDS = [
  "workspace",
  "data",
  "access",
  "routing",
  "network",
  "diagnostics",
  "danger",
] as const;
const authModeOptions = [
  { value: "password", label: "Password only" },
  { value: "oidc", label: "OIDC only" },
  { value: "both", label: "Password and OIDC" },
];
const accountStrategyOptions = [
  { value: "fill-first", label: "Fill First" },
  { value: "round-robin", label: "Round Robin" },
];
const comboStrategyOptions = [
  { value: "fallback", label: "Fallback" },
  { value: "round-robin", label: "Round Robin" },
];
const route = useRoute();
const active = computed(() => {
  const section = String(route.params.section || "workspace");
  return (SECTION_IDS as readonly string[]).includes(section)
    ? section
    : "workspace";
});
const queryClient = useQueryClient();
const notices = useNotificationStore();
const theme = useThemeStore();
const settings = useQuery({
  queryKey: ["settings"],
  queryFn: api.settings.get,
});
const proxyPools = useQuery({
  queryKey: ["proxy-pools"],
  queryFn: api.proxies.list,
});
const initialized = ref(false);
const proxyPoolOptions = computed(() => [
  { value: "", label: "No proxy (use per-connection settings)" },
  ...(proxyPools.data.value || [])
    .filter((pool) => pool.isActive !== false)
    .map((pool) => ({
      value: pool.id,
      label: pool.name || pool.proxyUrl || pool.id,
    })),
]);
const draft = reactive({
  requireLogin: true,
  authMode: "password",
  passwordCurrent: "",
  passwordNew: "",
  passwordConfirm: "",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  fallbackStrategy: "fill-first",
  comboStrategy: "fallback",
  stickyRoundRobinLimit: 3,
  comboStickyRoundRobinLimit: 1,
  quotaPageSize: 100,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  enableObservability: false,
  usageRetentionDays: 0,
  autoclawAutoClaimInterval: 60,
  codebuddyCliProbeInterval: 60,
  codebuddyCliProbeProxyPoolId: "",
});
const status = ref("");
const oidcRedirectUri = ref("");
const importInput = ref<HTMLInputElement>();
const browserWindow = typeof window === "undefined" ? null : window;
const browserStorage =
  typeof localStorage === "undefined" ? null : localStorage;
const logoutOpen = ref(false);
const shutdownOpen = ref(false);

function hydrate(value: Record<string, unknown> | undefined) {
  if (!value || initialized.value) return;
  for (const key of Object.keys(draft) as Array<keyof typeof draft>) {
    if (value[key] !== undefined) (draft[key] as unknown) = value[key] as never;
  }
  const autoclaw = value.autoclawAutoClaim as
    { intervalMinutes?: number } | undefined;
  if (autoclaw?.intervalMinutes !== undefined) {
    draft.autoclawAutoClaimInterval = autoclaw.intervalMinutes;
  }
  const codebuddyCliProbe = value.codebuddyIntlCliDailyProbe as
    { intervalMinutes?: number; proxyPoolId?: string } | undefined;
  if (codebuddyCliProbe?.intervalMinutes !== undefined) {
    draft.codebuddyCliProbeInterval = codebuddyCliProbe.intervalMinutes;
  }
  if (codebuddyCliProbe?.proxyPoolId !== undefined) {
    draft.codebuddyCliProbeProxyPoolId = codebuddyCliProbe.proxyPoolId;
  }
  initialized.value = true;
}
watch(() => settings.data.value, hydrate, { immediate: true });
onMounted(() => {
  oidcRedirectUri.value = `${window.location.origin}/api/auth/oidc/callback`;
});

const save = useMutation({
  mutationFn: async (patch: Record<string, unknown> = {}) =>
    api.settings.update(patch),
  onSuccess: (value) => {
    Object.assign(draft, value);
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    status.value = "Saved";
    notices.push("success", "Settings saved.");
  },
  onError: (error) => {
    status.value = error.message;
    notices.push("error", error.message);
  },
});
const canSavePassword = computed(
  () => !draft.passwordNew || draft.passwordNew === draft.passwordConfirm,
);
function savePatch(patch: Record<string, unknown> = {}) {
  save.mutate(patch);
}
function saveAutoclawInterval(minutes: number) {
  const current =
    (settings.data.value as Record<string, unknown> | undefined)
      ?.autoclawAutoClaim || {};
  savePatch({
    autoclawAutoClaim: {
      ...(current as Record<string, unknown>),
      intervalMinutes: minutes,
    },
  });
}
function saveCodebuddyCliProbeInterval(minutes: number) {
  const current =
    (settings.data.value as Record<string, unknown> | undefined)
      ?.codebuddyIntlCliDailyProbe || {};
  savePatch({
    codebuddyIntlCliDailyProbe: {
      ...(current as Record<string, unknown>),
      intervalMinutes: minutes,
    },
  });
}
function saveCodebuddyCliProbeProxyPool(proxyPoolId: string) {
  const current =
    (settings.data.value as Record<string, unknown> | undefined)
      ?.codebuddyIntlCliDailyProbe || {};
  savePatch({
    codebuddyIntlCliDailyProbe: {
      ...(current as Record<string, unknown>),
      proxyPoolId: proxyPoolId || null,
    },
  });
}
function savePassword() {
  if (!canSavePassword.value) return;
  savePatch({
    currentPassword: draft.passwordCurrent,
    newPassword: draft.passwordNew,
  });
  draft.passwordCurrent = "";
  draft.passwordNew = "";
  draft.passwordConfirm = "";
}
async function exportDatabase() {
  try {
    const payload = await api.settings.exportDatabase();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `lobakai-backup-${new Date().toISOString().replaceAll(":", "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    status.value = "Backup downloaded";
  } catch (error) {
    status.value = (error as Error).message;
  }
}
async function importDatabase(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (
    !window.confirm(
      "Import this backup and replace current settings? This action cannot be undone.",
    )
  ) {
    if (importInput.value) importInput.value.value = "";
    return;
  }
  try {
    await api.settings.importDatabase({
      ...(JSON.parse(await file.text()) as Record<string, unknown>),
      password: draft.passwordCurrent,
    });
    status.value = "Backup imported";
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  } catch (error) {
    status.value = (error as Error).message;
  }
  if (importInput.value) importInput.value.value = "";
}
async function testProxy() {
  try {
    const result = await api.settings.testProxy(
      draft.outboundProxyUrl || undefined,
    );
    status.value = result.ok
      ? `Proxy test OK (${result.status})`
      : result.error || "Proxy test failed";
  } catch (error) {
    status.value = (error as Error).message;
  }
}
async function logout() {
  try {
    await api.auth.logout();
    browserWindow?.location.assign("/login");
  } catch (error) {
    status.value = (error as Error).message;
  }
}
async function shutdown() {
  shutdownOpen.value = false;
  try {
    const result = await api.version.shutdown();
    status.value = result.message || "Shutdown request sent.";
  } catch (error) {
    status.value = (error as Error).message;
  }
}
</script>

<template>
  <div class="theme-v2 mx-auto w-full max-w-6xl space-y-6">
    <PageHeader
      title="Settings"
      description="Manage this local workspace, access controls, routing, and connectivity."
    />
    <div
      v-if="settings.isPending.value"
      class="flex items-start gap-8"
      role="status"
      aria-label="Loading settings"
    >
      <div class="max-w-3xl flex-1 space-y-4">
        <Skeleton class="h-6 w-40" />
        <Skeleton class="h-4 w-72" />
        <Skeleton class="h-40 w-full rounded-[10px]" />
        <Skeleton class="h-28 w-full rounded-[10px]" />
      </div>
    </div>
    <div v-else class="flex items-start gap-8">
      <main class="min-w-0 flex-1 max-w-3xl space-y-4">
        <section v-if="active === 'workspace'" class="space-y-4">
          <h2 class="text-lg font-semibold">Workspace</h2>
          <p class="text-sm text-muted-foreground">
            Appearance and local runtime details.
          </p>
          <Card class="space-y-5 p-5"
            ><div class="flex items-center justify-between gap-4">
              <div>
                <h3 class="font-semibold">Local Mode</h3>
                <p class="text-sm text-muted-foreground">
                  Running on your machine.
                </p>
              </div>
              <span
                class="rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success"
                >Local</span
              >
            </div>
            <div class="flex items-center gap-2 border-t pt-4">
              <Label>Theme</Label>
              <div class="ml-auto flex gap-1 rounded-lg bg-muted p-1">
                <button
                  v-for="option in ['light', 'dark', 'system']"
                  :key="option"
                  type="button"
                  :class="[
                    'rounded-md px-3 py-1.5 text-xs capitalize',
                    theme.theme === option
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground',
                  ]"
                  @click="
                    theme.theme = option as 'light' | 'dark' | 'system';
                    theme.apply();
                    browserStorage?.setItem('lobakai-theme', theme.theme);
                  "
                >
                  {{ option }}
                </button>
              </div>
            </div></Card
          ><Card class="flex items-center justify-between gap-4 p-5"
            ><div>
              <h3 class="font-semibold">Language</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                Choose the dashboard display language.
              </p>
            </div>
            <LanguageSwitcher
          /></Card>
        </section>

        <section v-if="active === 'data'" class="space-y-4">
          <h2 class="text-lg font-semibold">Data &amp; Backup</h2>
          <p class="text-sm text-muted-foreground">
            Export or restore the local LobakAI database.
          </p>
          <Card class="space-y-4 p-5"
            ><div>
              <h3 class="font-semibold">Local Database</h3>
              <p class="text-xs text-muted-foreground">
                Backups include local providers, keys, aliases, combos, and
                settings.
              </p>
              <p class="mt-1 break-all font-mono text-xs text-muted-foreground">
                {{
                  settings.data.value?.databasePath ||
                  "~/.lobakai/db/data.sqlite"
                }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" @click="exportDatabase"
                ><Download class="size-4" />Download Backup</Button
              ><Button variant="outline" @click="importInput?.click()"
                ><Upload class="size-4" />Import Backup</Button
              ><input
                ref="importInput"
                type="file"
                accept="application/json,.json"
                class="hidden"
                @change="importDatabase"
              /></div
          ></Card>
        </section>

        <section v-if="active === 'access'" class="space-y-4">
          <h2 class="text-lg font-semibold">Access</h2>
          <p class="text-sm text-muted-foreground">
            Protect dashboard access with a password or single sign-on.
          </p>
          <Card class="space-y-5 p-5"
            ><div class="flex items-center justify-between gap-4">
              <div>
                <h3 class="font-semibold">Require login</h3>
                <p class="text-xs text-muted-foreground">
                  When enabled, dashboard routes require a password session.
                </p>
              </div>
              <input
                v-model="draft.requireLogin"
                type="checkbox"
                class="size-4 accent-primary"
                @change="savePatch({ requireLogin: draft.requireLogin })"
              />
            </div>
            <div class="space-y-3 border-t pt-4">
              <h3 class="font-semibold">Password</h3>
              <Input
                v-model="draft.passwordCurrent"
                type="password"
                placeholder="Current password"
              />
              <div class="grid gap-3 sm:grid-cols-2">
                <Input
                  v-model="draft.passwordNew"
                  type="password"
                  placeholder="New password"
                /><Input
                  v-model="draft.passwordConfirm"
                  type="password"
                  placeholder="Confirm new password"
                />
              </div>
              <p v-if="!canSavePassword" class="text-xs text-destructive">
                Passwords do not match.
              </p>
              <Button
                :disabled="!canSavePassword || !draft.passwordNew"
                @click="savePassword"
                ><LockKeyhole class="size-4" />Update Password</Button
              >
            </div>
            <div class="space-y-3 border-t pt-4">
              <h3 class="font-semibold">OIDC Dashboard Login</h3>
              <div class="grid gap-3 sm:grid-cols-2">
                <Select
                  v-model="draft.authMode"
                  :options="authModeOptions"
                /><Input
                  v-model="draft.oidcLoginLabel"
                  placeholder="Sign in with OIDC"
                /><Input
                  v-model="draft.oidcIssuerUrl"
                  placeholder="Issuer URL"
                /><Input
                  v-model="draft.oidcClientId"
                  placeholder="Client ID"
                /><Input
                  v-model="draft.oidcClientSecret"
                  type="password"
                  placeholder="Client secret"
                /><Input
                  v-model="draft.oidcScopes"
                  placeholder="openid profile email"
                />
              </div>
              <div
                class="rounded-md border bg-muted p-3 text-xs text-muted-foreground"
              >
                Redirect URI:
                <code class="break-all">{{ oidcRedirectUri }}</code>
              </div>
              <Button
                @click="
                  savePatch({
                    authMode: draft.authMode,
                    oidcIssuerUrl: draft.oidcIssuerUrl,
                    oidcClientId: draft.oidcClientId,
                    oidcClientSecret: draft.oidcClientSecret || undefined,
                    oidcScopes: draft.oidcScopes,
                    oidcLoginLabel: draft.oidcLoginLabel,
                  })
                "
                ><Save class="size-4" />Save OIDC settings</Button
              >
            </div></Card
          >
        </section>

        <section v-if="active === 'routing'" class="space-y-4">
          <h2 class="text-lg font-semibold">Routing</h2>
          <p class="text-sm text-muted-foreground">
            Choose how requests are distributed across available accounts and
            combos.
          </p>
          <Card class="space-y-5 p-5"
            ><div class="grid gap-3 sm:grid-cols-2">
              <label class="space-y-1 text-sm"
                >Account strategy<Select
                  v-model="draft.fallbackStrategy"
                  :options="accountStrategyOptions"
                  class="mt-1"
                  @update:model-value="
                    savePatch({ fallbackStrategy: draft.fallbackStrategy })
                  " /></label
              ><label class="space-y-1 text-sm"
                >Account sticky limit<Input
                  v-model.number="draft.stickyRoundRobinLimit"
                  type="number"
                  min="1"
                  @change="
                    savePatch({
                      stickyRoundRobinLimit: draft.stickyRoundRobinLimit,
                    })
                  " /></label
              ><label class="space-y-1 text-sm"
                >Combo strategy<Select
                  v-model="draft.comboStrategy"
                  :options="comboStrategyOptions"
                  class="mt-1"
                  @update:model-value="
                    savePatch({ comboStrategy: draft.comboStrategy })
                  " /></label
              ><label class="space-y-1 text-sm"
                >Combo sticky limit<Input
                  v-model.number="draft.comboStickyRoundRobinLimit"
                  type="number"
                  min="1"
                  @change="
                    savePatch({
                      comboStickyRoundRobinLimit:
                        draft.comboStickyRoundRobinLimit,
                    })
                  " /></label
              ><label class="space-y-1 text-sm"
                >Quota page size<Input
                  v-model.number="draft.quotaPageSize"
                  type="number"
                  min="1"
                  max="500"
                  class="mt-1"
                  @change="
                    savePatch({
                      quotaPageSize: draft.quotaPageSize,
                    })
                  "
                /><span class="block text-xs text-muted-foreground"
                  >Max accounts per page on provider detail and quota
                  views.</span
                ></label
              >
            </div>
            ></Card
          >
        </section>

        <section v-if="active === 'network'" class="space-y-4">
          <h2 class="text-lg font-semibold">Network</h2>
          <p class="text-sm text-muted-foreground">
            Configure outbound traffic and client injector proxy behavior.
          </p>
          <Card class="space-y-5 p-5"
            ><div class="flex items-center justify-between">
              <div>
                <h3 class="font-semibold">Outbound Proxy</h3>
                <p class="text-xs text-muted-foreground">
                  Enable proxy for OAuth and provider outbound requests.
                </p>
              </div>
              <input
                v-model="draft.outboundProxyEnabled"
                type="checkbox"
                class="size-4 accent-primary"
                @change="
                  savePatch({
                    outboundProxyEnabled: draft.outboundProxyEnabled,
                  })
                "
              />
            </div>
            <div
              v-if="draft.outboundProxyEnabled"
              class="space-y-3 border-t pt-4"
            >
              <Input
                v-model="draft.outboundProxyUrl"
                placeholder="http://127.0.0.1:7897"
              /><Input
                v-model="draft.outboundNoProxy"
                placeholder="localhost,127.0.0.1"
              />
              <div class="flex gap-2">
                <Button variant="secondary" @click="testProxy"
                  ><Globe class="size-4" />Test proxy URL</Button
                ><Button
                  @click="
                    savePatch({
                      outboundProxyUrl: draft.outboundProxyUrl,
                      outboundNoProxy: draft.outboundNoProxy,
                    })
                  "
                  ><Save class="size-4" />Apply</Button
                >
              </div>
            </div>
            <div class="space-y-3 border-t pt-4">
              <h3 class="font-semibold">CodeBuddy CLI Probe Proxy</h3>
              <p class="text-xs text-muted-foreground">
                Proxy pool for codebuddy-intl-cli daily probes (check-in and
                activity report). Applies when no per-connection proxy is
                configured.
              </p>
              <Select
                v-model="draft.codebuddyCliProbeProxyPoolId"
                :options="proxyPoolOptions"
                @update:model-value="
                  saveCodebuddyCliProbeProxyPool($event as string)
                "
              /></div
          ></Card>
        </section>

        <section v-if="active === 'diagnostics'" class="space-y-4">
          <h2 class="text-lg font-semibold">Diagnostics</h2>
          <p class="text-sm text-muted-foreground">
            Control request logging for troubleshooting.
          </p>
          <Card class="flex items-center justify-between gap-4 p-5"
            ><div>
              <h3 class="font-semibold">Enable Observability</h3>
              <p class="text-xs text-muted-foreground">
                Record request details for inspection in the logs view.
              </p>
            </div>
            <input
              v-model="draft.enableObservability"
              type="checkbox"
              class="size-4 accent-primary"
              @change="
                savePatch({ enableObservability: draft.enableObservability })
              "
          /></Card>
          <Card class="space-y-2 p-5"
            ><label class="block space-y-1 text-sm"
              ><span class="font-semibold">Usage raw retention (days)</span
              ><Input
                v-model.number="draft.usageRetentionDays"
                type="number"
                min="0"
                class="mt-1 max-w-40"
                @change="
                  savePatch({
                    usageRetentionDays: Math.max(
                      0,
                      Math.floor(Number(draft.usageRetentionDays) || 0),
                    ),
                  })
                " /></label
            ><span class="block text-xs text-muted-foreground"
              >Raw Usage rows older than this move into daily totals every
              hour. Totals stay the same. 0 keeps all raw rows.</span
            ></Card
          >
        </section>

        <section v-if="active === 'danger'" class="space-y-4">
          <h2 class="text-lg font-semibold">Danger Zone</h2>
          <p class="text-sm text-muted-foreground">
            End the current dashboard session or stop the local proxy server.
          </p>
          <Card class="flex flex-wrap gap-2 border-destructive/40 p-5"
            ><Button variant="outline" @click="logoutOpen = true"
              ><X class="size-4" />Logout</Button
            ><Button variant="destructive" @click="shutdownOpen = true"
              ><AlertTriangle class="size-4" />Shutdown</Button
            ></Card
          >
        </section>
        <ConfirmModal
          :open="logoutOpen"
          title="Log out"
          message="End the current dashboard session?"
          confirm-text="Log out"
          @confirm="logout"
          @close="logoutOpen = false"
        />
        <ConfirmModal
          :open="shutdownOpen"
          title="Shutdown server"
          message="Stop the local server? Existing requests will be interrupted."
          confirm-text="Shutdown"
          @confirm="shutdown"
          @close="shutdownOpen = false"
        />
        <p
          v-if="status"
          class="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Check class="size-4 text-success" />{{ status }}
        </p>
      </main>
    </div>
  </div>
</template>
