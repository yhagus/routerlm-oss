<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  Cable,
  Check,
  ClipboardPlus,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wifi,
  X,
} from "lucide-vue-next";
import { api } from "@/lib/api";
import type { ProxyPool } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import DataTable from "@/components/app/DataTable.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";
import Badge from "@/components/ui/badge.vue";
import Select from "@/components/ui/select.vue";
import { useNotificationStore } from "@/stores/notifications";
import Modal from "@/components/ui/modal.vue";

const queryClient = useQueryClient();
const notices = useNotificationStore();
const pools = useQuery({
  queryKey: ["proxy-pools"],
  queryFn: api.proxies.list,
});
const showForm = ref(false);
const editingId = ref<string | null>(null);
const form = reactive({
  name: "",
  proxyUrl: "",
  type: "http",
  noProxy: "",
  strictProxy: false,
  isActive: true,
});
const testingId = ref<string | null>(null);
const showBatchImport = ref(false);
const batchText = ref("");
const importing = ref(false);
const proxyTypeOptions = [
  { value: "http", label: "HTTP" },
  { value: "vercel", label: "Vercel relay" },
  { value: "cloudflare", label: "Cloudflare relay" },
  { value: "deno", label: "Deno relay" },
];

const poolRows = computed(() => pools.data.value || []);
const activeCount = computed(() => poolRows.value.filter(isActive).length);
const formTitle = computed(() =>
  editingId.value ? "Edit proxy pool" : "Add proxy pool",
);

function proxyUrl(pool: ProxyPool) {
  return pool.proxyUrl || pool.proxy_url || "";
}

function isActive(pool: ProxyPool) {
  return pool.isActive !== undefined ? pool.isActive : pool.is_active !== 0;
}

function resetForm() {
  editingId.value = null;
  form.name = "";
  form.proxyUrl = "";
  form.type = "http";
  form.noProxy = "";
  form.strictProxy = false;
  form.isActive = true;
  showForm.value = false;
}

function startCreate() {
  resetForm();
  showForm.value = true;
}

function startEdit(pool: ProxyPool) {
  editingId.value = pool.id;
  form.name = pool.name || "";
  form.proxyUrl = proxyUrl(pool);
  const data = pool as ProxyPool & {
    type?: string;
    noProxy?: string;
    strictProxy?: boolean;
  };
  form.type = String(data.type || "http");
  form.noProxy = String(data.noProxy || "");
  form.strictProxy = data.strictProxy === true;
  form.isActive = isActive(pool);
  showForm.value = true;
}

const save = useMutation({
  mutationFn: () => {
    const input = {
      name: form.name.trim(),
      proxyUrl: form.proxyUrl.trim(),
      type: form.type,
      noProxy: form.noProxy.trim(),
      strictProxy: form.strictProxy,
      isActive: form.isActive,
    };
    return editingId.value
      ? api.proxies.update(editingId.value, input)
      : api.proxies.create(input);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["proxy-pools"] });
    notices.push(
      "success",
      editingId.value ? "Proxy pool updated." : "Proxy pool created.",
    );
    resetForm();
  },
  onError: (error) =>
    notices.push("error", error.message, "Could not save proxy pool"),
});

const remove = useMutation({
  mutationFn: api.proxies.remove,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["proxy-pools"] });
    notices.push("success", "Proxy pool removed.");
  },
  onError: (error) =>
    notices.push("error", error.message, "Could not remove proxy pool"),
});

const toggle = useMutation({
  mutationFn: (pool: ProxyPool) =>
    api.proxies.update(pool.id, { isActive: !isActive(pool) }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proxy-pools"] }),
  onError: (error) =>
    notices.push("error", error.message, "Could not update proxy pool"),
});

function submit() {
  if (!form.name.trim() || !form.proxyUrl.trim()) return;
  save.mutate();
}

async function importBatch() {
  const entries = batchText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!entries.length || importing.value) return;
  importing.value = true;
  try {
    const existing = new Set(poolRows.value.map((pool) => proxyUrl(pool)));
    let created = 0;
    for (const value of entries) {
      const parts = value.split(":");
      const url = value.includes("://")
        ? value
        : parts.length === 4
          ? `http://${encodeURIComponent(parts[2])}:${encodeURIComponent(parts[3])}@${parts[0]}:${parts[1]}`
          : `http://${value}`;
      if (existing.has(url)) continue;
      const host = new URL(url).host;
      await api.proxies.create({
        name: host,
        proxyUrl: url,
        type: "http",
        isActive: true,
      });
      existing.add(url);
      created += 1;
    }
    notices.push(
      "success",
      `Imported ${created} proxy pool${created === 1 ? "" : "s"}.`,
    );
    batchText.value = "";
    showBatchImport.value = false;
    await queryClient.invalidateQueries({ queryKey: ["proxy-pools"] });
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not import proxy pools.",
    );
  } finally {
    importing.value = false;
  }
}

function confirmRemove(pool: ProxyPool) {
  if (window.confirm(`Remove proxy pool "${pool.name}"?`))
    remove.mutate(pool.id);
}

async function test(pool: ProxyPool) {
  testingId.value = pool.id;
  try {
    const result = await api.proxies.test(pool.id);
    notices.push(
      result.ok ? "success" : "error",
      result.ok ? "Proxy test passed." : result.error || "Proxy test failed.",
    );
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Proxy test failed.",
    );
  } finally {
    testingId.value = null;
    await queryClient.invalidateQueries({ queryKey: ["proxy-pools"] });
  }
}
</script>

<template>
  <div class="theme-v2 space-y-6">
    <PageHeader
      title="Proxy pools"
      description="Store reusable outbound proxy routes and verify their current transport status."
    >
      <template #actions>
        <Button
          variant="outline"
          :disabled="pools.isFetching.value"
          @click="pools.refetch()"
        >
          <RefreshCw
            :class="['size-4', pools.isFetching.value && 'animate-spin']"
          />
          Refresh
        </Button>
        <Button variant="outline" @click="showBatchImport = true"
          ><ClipboardPlus class="size-4" />Batch import</Button
        ><Button @click="startCreate"><Plus class="size-4" />Add pool</Button>
      </template>
    </PageHeader>

    <div
      v-if="pools.isError.value"
      role="alert"
      class="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
    >
      <X class="mt-0.5 size-4 shrink-0" />
      <div class="min-w-0 flex-1">
        <p class="font-medium">Proxy pools could not be loaded.</p>
        <p class="mt-1 text-destructive/80">
          {{
            pools.error.value instanceof Error
              ? pools.error.value.message
              : "The v2 proxy-pool endpoint returned an error."
          }}
        </p>
      </div>
      <Button variant="outline" @click="pools.refetch()">Try again</Button>
    </div>

    <Modal :open="showForm" :title="formTitle" size="lg" @close="resetForm">
      <p class="mb-5 text-xs text-muted-foreground">
        The URL is stored by the v2 backend and can be assigned by routing code
        when proxy transport is implemented.
      </p>
      <form class="grid gap-4 md:grid-cols-2" @submit.prevent="submit">
        <div class="space-y-2">
          <Label for="pool-name">Name</Label
          ><Input
            id="pool-name"
            v-model="form.name"
            placeholder="Primary egress"
            required
          />
        </div>
        <div class="space-y-2">
          <Label for="pool-url">Proxy URL</Label
          ><Input
            id="pool-url"
            v-model="form.proxyUrl"
            type="url"
            placeholder="http://user:pass@host:port"
            required
          />
        </div>
        <div class="space-y-2">
          <Label for="pool-type">Type</Label
          ><Select
            id="pool-type"
            v-model="form.type"
            :options="proxyTypeOptions"
          />
        </div>
        <div class="space-y-2 md:col-span-2">
          <Label for="pool-no-proxy">No proxy hosts</Label
          ><Input
            id="pool-no-proxy"
            v-model="form.noProxy"
            placeholder="localhost,127.0.0.1"
          />
        </div>
        <label class="flex items-start gap-3 rounded-lg border p-3 text-sm"
          ><input
            v-model="form.isActive"
            type="checkbox"
            class="mt-0.5 size-4 accent-primary"
          /><span
            ><span class="block font-medium">Enabled for routing</span
            ><span class="mt-1 block text-xs text-muted-foreground"
              >Persist the pool as active.</span
            ></span
          ></label
        ><label class="flex items-start gap-3 rounded-lg border p-3 text-sm"
          ><input
            v-model="form.strictProxy"
            type="checkbox"
            class="mt-0.5 size-4 accent-primary"
          /><span
            ><span class="block font-medium">Require this proxy</span
            ><span class="mt-1 block text-xs text-muted-foreground"
              >Fail requests when this proxy cannot connect.</span
            ></span
          ></label
        >
        <div class="flex gap-2 md:col-span-2">
          <Button type="submit" :disabled="save.isPending.value">{{
            save.isPending.value
              ? "Saving..."
              : editingId
                ? "Save changes"
                : "Create pool"
          }}</Button
          ><Button variant="ghost" type="button" @click="resetForm"
            >Cancel</Button
          >
        </div>
      </form>
    </Modal>
    <Modal
      :open="showBatchImport"
      title="Batch import proxy pools"
      @close="showBatchImport = false"
      ><p class="mb-4 text-sm text-muted-foreground">
        Enter one proxy URL per line.
      </p>
      <textarea
        v-model="batchText"
        rows="10"
        class="w-full rounded-md border bg-background p-3 font-mono text-sm"
        placeholder="http://user:pass@host:port&#10;socks5://host:1080&#10;host:port:user:pass"
      />
      <div class="mt-4 flex gap-2">
        <Button
          :disabled="importing || !batchText.trim()"
          @click="importBatch"
          >{{ importing ? "Importing..." : "Import pools" }}</Button
        ><Button variant="ghost" @click="showBatchImport = false"
          >Cancel</Button
        >
      </div></Modal
    >

    <div class="grid gap-3 sm:grid-cols-2">
      <Card class="p-4"
        ><p class="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Configured pools
        </p>
        <p class="mt-2 text-2xl font-semibold tabular-nums">
          {{ poolRows.length }}
        </p></Card
      >
      <Card class="p-4"
        ><p class="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Enabled pools
        </p>
        <p class="mt-2 text-2xl font-semibold tabular-nums text-success">
          {{ activeCount }}
        </p></Card
      >
    </div>

    <EmptyState
      v-if="!pools.isPending.value && !pools.isError.value && !poolRows.length"
      title="No proxy pools"
      description="Add a proxy URL when upstream traffic needs a reusable outbound route."
      ><Button @click="startCreate"
        ><Plus class="size-4" />Add pool</Button
      ></EmptyState
    >

    <DataTable
      v-else-if="!pools.isError.value"
      :loading="pools.isPending.value"
      :columns="['Pool', 'Endpoint', 'State', 'Actions']"
      :empty="!poolRows.length"
      empty-title="No proxy pools"
      empty-description="Add a proxy URL to create the first outbound route."
    >
      <tr
        v-for="pool in poolRows"
        :key="pool.id"
        class="transition-colors hover:bg-muted/35"
      >
        <td class="px-3.75 py-2.25">
          <div class="flex items-center gap-3">
            <div
              class="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground"
            >
              <Cable class="size-4" />
            </div>
            <div class="min-w-0">
              <p class="truncate font-medium">{{ pool.name }}</p>
              <p class="mt-1 font-mono text-[11px] text-muted-foreground">
                {{ pool.id }}
              </p>
            </div>
          </div>
        </td>
        <td class="max-w-[360px] px-3.75 py-2.25">
          <p
            class="truncate font-mono text-xs text-muted-foreground"
            :title="proxyUrl(pool)"
          >
            {{ proxyUrl(pool) }}
          </p>
          <p class="mt-1 text-[11px] text-muted-foreground">
            Transport status: {{ pool.testStatus || "not checked" }}
          </p>
        </td>
        <td class="px-3.75 py-2.25">
          <Badge :variant="isActive(pool) ? 'success' : 'secondary'">{{
            isActive(pool) ? "Enabled" : "Disabled"
          }}</Badge>
        </td>
        <td class="px-3.75 py-2.25">
          <div class="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Test proxy pool"
              :disabled="testingId === pool.id"
              @click="test(pool)"
              ><LoaderCircle
                v-if="testingId === pool.id"
                class="size-4 animate-spin" /><Wifi
                v-else
                class="size-4" /></Button
            ><Button
              variant="ghost"
              size="icon"
              :aria-label="
                isActive(pool) ? 'Disable proxy pool' : 'Enable proxy pool'
              "
              :disabled="toggle.isPending.value"
              @click="toggle.mutate(pool)"
              ><Check v-if="isActive(pool)" class="size-4 text-success" /><span
                v-else
                class="text-xs"
                >On</span
              ></Button
            ><Button
              variant="ghost"
              size="icon"
              aria-label="Edit proxy pool"
              @click="startEdit(pool)"
              ><Pencil class="size-4" /></Button
            ><Button
              variant="ghost"
              size="icon"
              aria-label="Remove proxy pool"
              :disabled="remove.isPending.value"
              @click="confirmRemove(pool)"
              ><Trash2 class="size-4 text-destructive"
            /></Button>
          </div>
        </td>
      </tr>
    </DataTable>
  </div>
</template>
