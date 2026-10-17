<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  FileKey2,
  Globe2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Save,
  Shield,
  ShieldAlert,
} from "lucide-vue-next";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import PageHeader from "@/components/app/PageHeader.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import Card from "@/components/ui/card.vue";
import Input from "@/components/ui/input.vue";
import Select from "@/components/ui/select.vue";
import { useNotificationStore } from "@/stores/notifications";
import Modal from "@/components/ui/modal.vue";

const tools = ["antigravity", "copilot", "kiro", "cursor"];
const toolOptions = tools.map((tool) => ({ value: tool, label: tool }));
const selectedTool = ref("antigravity");
const queryClient = useQueryClient();
const notices = useNotificationStore();
const status = useQuery({
  queryKey: ["mitm", "status"],
  queryFn: api.host.mitm.status,
});
const aliases = useQuery({
  queryKey: ["mitm", "aliases"],
  queryFn: () => api.host.mitm.aliases(),
});
const keys = useQuery({ queryKey: ["api-keys"], queryFn: api.keys.list });
const aliasDraft = ref<Array<{ alias: string; target: string }>>([]);
const selectedApiKey = ref("");
const sudoPassword = ref("");
const busy = ref("");
const saving = ref(false);
const showAliasEditor = ref(false);

const activeKeys = computed(() =>
  (keys.data.value || []).filter((key) => key.isActive),
);
const dnsStatus = computed(() =>
  status.data.value?.dnsStatus &&
  typeof status.data.value.dnsStatus === "object"
    ? (status.data.value.dnsStatus as Record<string, boolean>)
    : {},
);
const requestedDnsStatus = computed(() =>
  status.data.value?.requestedDnsStatus &&
  typeof status.data.value.requestedDnsStatus === "object"
    ? (status.data.value.requestedDnsStatus as Record<string, boolean>)
    : {},
);

watch(
  activeKeys,
  (value) => {
    if (!selectedApiKey.value)
      selectedApiKey.value = value.find((key) => key.key)?.key || "";
  },
  { immediate: true },
);
function hydrateAliases(value: Record<string, unknown> | undefined) {
  const all = value?.aliases;
  const mappings =
    all && typeof all === "object" && !Array.isArray(all)
      ? (all as Record<string, unknown>)[selectedTool.value]
      : undefined;
  const entries =
    mappings && typeof mappings === "object" && !Array.isArray(mappings)
      ? Object.entries(mappings as Record<string, unknown>)
      : [];
  aliasDraft.value = entries.map(([alias, target]) => ({
    alias,
    target: String(target),
  }));
}
watch(
  () => aliases.data.value,
  (value) => hydrateAliases(value),
  { immediate: true },
);
watch(selectedTool, () => hydrateAliases(aliases.data.value));

async function refresh() {
  await Promise.all([status.refetch(), aliases.refetch(), keys.refetch()]);
}
async function run(name: string, operation: () => Promise<unknown>) {
  busy.value = name;
  try {
    await operation();
    await status.refetch();
    notices.push("success", `${name} completed.`);
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : `${name} failed.`,
    );
  } finally {
    busy.value = "";
  }
}
async function start() {
  if (!selectedApiKey.value) {
    notices.push("error", "Select an active API key before starting MITM.");
    return;
  }
  await run("Start MITM", () =>
    api.host.mitm.start({
      apiKey: selectedApiKey.value,
      sudoPassword: sudoPassword.value || undefined,
    }),
  );
}
async function stop() {
  if (!window.confirm("Stop the MITM server?")) return;
  await run("Stop MITM", () =>
    api.host.mitm.stop({ sudoPassword: sudoPassword.value || undefined }),
  );
}
async function trustCert() {
  if (!window.confirm("Trust the local MITM certificate?")) return;
  await run("Trust certificate", () =>
    api.host.mitm.update({
      tool: selectedTool.value,
      action: "trust-cert",
      sudoPassword: sudoPassword.value || undefined,
    }),
  );
}
async function setDns(tool: string, enabled: boolean) {
  if (!enabled && !window.confirm(`Disable ${tool} DNS interception?`)) return;
  await run(`${enabled ? "Enable" : "Disable"} ${tool} DNS`, () =>
    api.host.mitm.update({
      tool,
      action: enabled ? "enable" : "disable",
      sudoPassword: sudoPassword.value || undefined,
    }),
  );
}
function addAlias() {
  aliasDraft.value.push({ alias: "", target: "" });
}
function removeAlias(index: number) {
  aliasDraft.value.splice(index, 1);
}
async function saveAliases() {
  const mappings = Object.fromEntries(
    aliasDraft.value
      .map((entry) => [entry.alias.trim(), entry.target.trim()])
      .filter(([alias, target]) => alias && target),
  );
  saving.value = true;
  try {
    await api.host.mitm.saveAliases(selectedTool.value, mappings);
    await queryClient.invalidateQueries({ queryKey: ["mitm", "aliases"] });
    notices.push("success", `${selectedTool.value} model aliases saved.`);
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not save MITM aliases.",
    );
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="MITM tools"
      description="Operate the local interception server, certificate trust, per-tool DNS, and model aliases."
      ><template #actions
        ><Button
          variant="outline"
          size="sm"
          :disabled="Boolean(busy) || status.isFetching.value"
          @click="refresh"
          ><RefreshCw
            :class="['size-4', status.isFetching.value && 'animate-spin']"
          />Refresh status</Button
        ></template
      ></PageHeader
    >
    <div
      v-if="status.isError.value || aliases.isError.value"
      role="alert"
      class="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
    >
      <ShieldAlert class="mt-0.5 size-4 shrink-0" />
      <p>
        {{
          (status.error.value || aliases.error.value) instanceof Error
            ? (status.error.value || aliases.error.value)?.message
            : "The v2 MITM endpoint returned an error."
        }}
      </p>
    </div>
    <Card class="border-warning/25 bg-warning/5 p-5"
      ><div class="flex items-start gap-3">
        <div
          class="grid size-10 shrink-0 place-items-center rounded-xl bg-warning/12 text-warning"
        >
          <ShieldAlert class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-semibold">Local HTTPS interception</h2>
          <p class="mt-1 text-sm leading-6 text-muted-foreground">
            MITM changes local certificate and DNS state for IDE tools. The
            controls below call the live backend and surface host permission
            errors.
          </p>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label class="space-y-1.5"
              ><span class="text-xs font-medium">API key used by MITM</span
              ><Input
                v-model="selectedApiKey"
                type="password"
                autocomplete="off"
                placeholder="Paste an active API key"
              /><span class="block text-[11px] text-muted-foreground"
                >{{ activeKeys.length }} active dashboard key{{
                  activeKeys.length === 1 ? "" : "s"
                }}
                available; secrets are never returned by the key list.</span
              ></label
            ><label class="space-y-1.5"
              ><span class="text-xs font-medium"
                >Sudo password
                <span class="font-normal text-muted-foreground"
                  >(optional when cached)</span
                ></span
              ><Input
                v-model="sudoPassword"
                type="password"
                autocomplete="off"
                placeholder="Only used for this operation"
            /></label>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              :disabled="Boolean(busy) || !selectedApiKey"
              @click="start"
              ><LoaderCircle
                v-if="busy === 'Start MITM'"
                class="size-4 animate-spin"
              /><Shield class="size-4" />Start MITM</Button
            ><Button
              variant="outline"
              size="sm"
              :disabled="Boolean(busy)"
              @click="stop"
              ><LoaderCircle
                v-if="busy === 'Stop MITM'"
                class="size-4 animate-spin"
              />Stop MITM</Button
            ><Button
              variant="outline"
              size="sm"
              :disabled="Boolean(busy)"
              @click="trustCert"
              ><LockKeyhole class="size-4" />Trust certificate</Button
            >
          </div>
        </div>
      </div></Card
    >
    <div class="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
      <Card class="overflow-hidden"
        ><div
          class="flex items-start gap-3 border-b border-border/70 px-5 py-4"
        >
          <div
            class="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"
          >
            <FileKey2 class="size-4" />
          </div>
          <div>
            <h2 class="text-sm font-semibold">Live interception status</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              Read-only process and certificate telemetry.
            </p>
          </div>
        </div>
        <dl class="divide-y px-5">
          <div class="flex items-center justify-between gap-4 py-3 text-sm">
            <dt class="text-muted-foreground">Running</dt>
            <dd>
              <Badge
                :variant="status.data.value?.running ? 'success' : 'secondary'"
                >{{ status.data.value?.running ? "Running" : "Stopped" }}</Badge
              >
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4 py-3 text-sm">
            <dt class="text-muted-foreground">Certificate</dt>
            <dd>
              {{
                status.data.value?.certTrusted
                  ? "Trusted"
                  : status.data.value?.certExists
                    ? "Present, not trusted"
                    : "Not found"
              }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4 py-3 text-sm">
            <dt class="text-muted-foreground">Router base URL</dt>
            <dd class="font-mono text-xs">
              {{ status.data.value?.mitmRouterBaseUrl || "-" }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4 py-3 text-sm">
            <dt class="text-muted-foreground">Last status read</dt>
            <dd class="text-xs text-muted-foreground">
              {{
                status.dataUpdatedAt.value
                  ? date(status.dataUpdatedAt.value)
                  : "-"
              }}
            </dd>
          </div>
        </dl>
        <div class="border-t border-border/70 px-5 py-4">
          <div class="mb-3 flex items-center gap-2">
            <LockKeyhole class="size-4 text-muted-foreground" />
            <p
              class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              DNS interception
            </p>
          </div>
          <div class="space-y-2">
            <div
              v-for="tool in tools"
              :key="tool"
              class="flex items-center justify-between gap-3 rounded-lg bg-muted/45 px-3 py-2.5 text-sm"
            >
              <span class="font-medium">{{ tool }}</span>
              <div class="flex items-center gap-2">
                <Badge
                  :variant="
                    dnsStatus[tool]
                      ? 'success'
                      : requestedDnsStatus[tool]
                        ? 'warning'
                        : 'secondary'
                  "
                  >{{
                    dnsStatus[tool]
                      ? "Enabled"
                      : requestedDnsStatus[tool]
                        ? "Requested"
                        : "Off"
                  }}</Badge
                ><Button
                  size="sm"
                  variant="ghost"
                  :disabled="Boolean(busy) || !status.data.value?.running"
                  @click="setDns(tool, !dnsStatus[tool])"
                  >{{ dnsStatus[tool] ? "Disable" : "Enable" }}</Button
                >
              </div>
            </div>
          </div>
        </div></Card
      >
      <Card class="overflow-hidden"
        ><div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4"
        >
          <div>
            <h2 class="text-sm font-semibold">Model aliases</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              Mappings are persisted and used by the local MITM integration.
            </p>
          </div>
          <Badge variant="success">Alias persistence</Badge>
        </div>
        <div class="space-y-4 p-5">
          <label class="space-y-2"
            ><span class="text-xs font-medium">IDE tool</span
            ><Select v-model="selectedTool" :options="toolOptions"
          /></label>
          <p class="text-sm text-muted-foreground">
            {{
              aliasDraft.length
                ? `${aliasDraft.length} alias mapping${aliasDraft.length === 1 ? "" : "s"} saved for ${selectedTool}.`
                : `No aliases saved for ${selectedTool}.`
            }}
          </p>
          <Button size="sm" @click="showAliasEditor = true"
            ><KeyRound class="size-4" />Edit aliases</Button
          >
        </div></Card
      >
    </div>
  </div>
  <Modal
    :open="showAliasEditor"
    title="Edit MITM model aliases"
    size="lg"
    @close="showAliasEditor = false"
  >
    <div class="space-y-4">
      <label class="space-y-2"
        ><span class="text-xs font-medium">IDE tool</span
        ><Select v-model="selectedTool" :options="toolOptions"
      /></label>
      <div
        v-if="!aliasDraft.length"
        class="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground"
      >
        No aliases saved for {{ selectedTool }}.
      </div>
      <div
        v-for="(entry, index) in aliasDraft"
        :key="index"
        class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
      >
        <Input
          v-model="entry.alias"
          :aria-label="`${selectedTool} alias ${index + 1}`"
          placeholder="sonnet"
        /><Input
          v-model="entry.target"
          :aria-label="`${selectedTool} target ${index + 1}`"
          placeholder="provider/model"
        /><Button
          variant="ghost"
          size="icon"
          aria-label="Remove alias"
          @click="removeAlias(index)"
          >Remove</Button
        >
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" @click="addAlias"
          >Add mapping</Button
        ><Button
          size="sm"
          :disabled="saving"
          @click="
            saveAliases();
            showAliasEditor = false;
          "
          ><Save class="size-4" />{{
            saving ? "Saving..." : "Save aliases"
          }}</Button
        >
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.space-y-3.p-5 {
  display: none;
}
</style>
