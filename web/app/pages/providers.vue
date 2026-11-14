<script setup lang="ts">
import { Network, Pencil, Plus, Power, Trash2 } from "@lucide/vue";
import { ref } from "vue";
import {
  type AuthStyle,
  type Provider,
  type ProviderQuirks,
  REASONING_CONTENT_IN_HISTORY,
  UPSTREAM_PROTOCOLS,
} from "~/lib/upstream";

useHead({ title: "Providers" });

type ProviderDialog =
  | { kind: "create" }
  | { kind: "edit"; provider: Provider }
  | { kind: "delete"; provider: Provider };

const { $dashboardApi } = useNuxtApp();
const {
  data: providers,
  error: loadError,
  refresh,
} = await useDashboardApi<Provider[]>("/providers");

const protocolOptions = UPSTREAM_PROTOCOLS.map((protocol) => ({
  label: protocol,
  value: protocol,
}));
const authStyleOptions = [
  { label: "Authorization: Bearer", value: "bearer" },
  { label: "x-api-key header", value: "x-api-key" },
] satisfies { label: string; value: AuthStyle }[];
const reasoningOptions = [
  { label: "Not needed", value: "" },
  { label: "Every assistant turn", value: "all-assistant-turns" },
  { label: "Turns with tool calls", value: "tool-call-turns" },
];

const {
  dialog,
  isDialogOpen,
  isSaving,
  dialogError,
  showDialog,
  closeDialog,
  submitDialog,
  deleteRow,
  toggleRow,
} = useEditableList<ProviderDialog>("/providers", refresh);

interface ProviderForm {
  slug: string;
  name: string;
  protocol: string;
  baseUrl: string;
  authStyle: string;
  reasoningContentInHistory: string;
  acceptsCacheControl: boolean;
  acceptsPromptCacheKey: boolean;
  usesMaxCompletionTokens: boolean;
  /** Blank means the default (four); the number input gives a number otherwise. */
  cacheMarkerLimit: number | "";
}

const form = ref<ProviderForm>({
  slug: "",
  name: "",
  protocol: "openai-chat",
  baseUrl: "",
  authStyle: "bearer",
  reasoningContentInHistory: "",
  acceptsCacheControl: false,
  acceptsPromptCacheKey: false,
  usesMaxCompletionTokens: false,
  cacheMarkerLimit: "",
});

function openDialog(next: ProviderDialog): void {
  showDialog(next);
  if (next.kind === "delete") return;
  const provider = next.kind === "edit" ? next.provider : undefined;
  form.value = {
    slug: provider?.slug ?? "",
    name: provider?.name ?? "",
    protocol: provider?.protocol ?? "openai-chat",
    baseUrl: provider?.baseUrl ?? "",
    authStyle: provider?.authStyle ?? "bearer",
    reasoningContentInHistory: provider?.quirks.reasoningContentInHistory ?? "",
    acceptsCacheControl: provider?.quirks.acceptsCacheControl ?? false,
    acceptsPromptCacheKey: provider?.quirks.acceptsPromptCacheKey ?? false,
    usesMaxCompletionTokens: provider?.quirks.usesMaxCompletionTokens ?? false,
    cacheMarkerLimit: provider?.quirks.cacheMarkerLimit ?? "",
  };
}

/** Only the quirks that are set; the backend rejects unknown keys. */
function quirksFromForm(): ProviderQuirks {
  if (form.value.protocol === "anthropic-messages") {
    const limit = form.value.cacheMarkerLimit;
    return limit === "" ? {} : { cacheMarkerLimit: limit };
  }
  if (form.value.protocol !== "openai-chat") return {};
  const quirks: ProviderQuirks = {};
  const reasoning = REASONING_CONTENT_IN_HISTORY.find(
    (value) => value === form.value.reasoningContentInHistory,
  );
  if (reasoning) quirks.reasoningContentInHistory = reasoning;
  if (form.value.acceptsCacheControl) quirks.acceptsCacheControl = true;
  if (form.value.acceptsPromptCacheKey) quirks.acceptsPromptCacheKey = true;
  if (form.value.usesMaxCompletionTokens) quirks.usesMaxCompletionTokens = true;
  return quirks;
}

async function saveProvider(): Promise<void> {
  const current = dialog.value;
  if (!current || current.kind === "delete") return;
  const fields = {
    name: form.value.name,
    protocol: form.value.protocol,
    baseUrl: form.value.baseUrl,
    authStyle: form.value.authStyle,
    quirks: quirksFromForm(),
  };
  const failureMessage = "Couldn't save the Provider.";
  if (current.kind === "create") {
    await submitDialog(
      () =>
        $dashboardApi("/providers", { method: "POST", body: { slug: form.value.slug, ...fields } }),
      `Added ${fields.name}`,
      failureMessage,
    );
    return;
  }
  await submitDialog(
    () => $dashboardApi(`/providers/${current.provider.id}`, { method: "PATCH", body: fields }),
    `Saved ${fields.name}`,
    failureMessage,
  );
}

function deleteProvider(provider: Provider): Promise<void> {
  return deleteRow(provider, provider.name, "Couldn't delete the Provider.");
}

function toggleProvider(provider: Provider): Promise<void> {
  return toggleRow(provider, provider.name);
}

function quirkSummary(quirks: ProviderQuirks): string {
  return Object.keys(quirks).join(", ") || "—";
}
</script>

<template>
  <PageHeading
    title="Providers"
    description="The upstream services the gateway calls, from the Catalog or added by hand. Any Provider that speaks a known Protocol can be added here."
  >
    <button class="button button--primary" type="button" @click="openDialog({ kind: 'create' })">
      <Plus :size="14" /> Add Provider
    </button>
  </PageHeading>

  <section class="panel table-panel">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Protocol</th>
            <th>Base URL</th>
            <th>Auth</th>
            <th>Quirks</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="provider in providers" :key="provider.id">
            <td>
              <div class="table-entity">
                <span class="key-icon"><Network :size="15" /></span
                ><strong>{{ provider.name }}</strong
                ><span class="cell-note">{{ provider.slug }}</span>
              </div>
            </td>
            <td>{{ provider.protocol }}</td>
            <td>{{ provider.baseUrl }}</td>
            <td>{{ provider.authStyle }}</td>
            <td>{{ quirkSummary(provider.quirks) }}</td>
            <td>
              <span
                class="status-badge"
                :class="provider.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
                >{{ provider.isEnabled ? "Enabled" : "Disabled" }}</span
              >
            </td>
            <td>
              <div class="row-actions">
                <button class="row-action" @click="openDialog({ kind: 'edit', provider })">
                  <Pencil :size="14" /> Edit
                </button>
                <button class="row-action" @click="toggleProvider(provider)">
                  <Power :size="14" /> {{ provider.isEnabled ? "Disable" : "Enable" }}
                </button>
                <button class="row-action" @click="openDialog({ kind: 'delete', provider })">
                  <Trash2 :size="14" /> Delete
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="loadError" class="empty-state">
        <strong>Couldn't load Providers.</strong
        ><span>Check that the backend is running, then reload the page.</span>
      </div>
      <div v-else-if="providers?.length === 0" class="empty-state">
        <strong>No Providers yet.</strong
        ><span>Run <code>bun run db:seed</code> to load the Catalog, or add one by hand.</span>
      </div>
    </div>
  </section>

  <AppDialog
    v-if="dialog && dialog.kind !== 'delete'"
    v-model:open="isDialogOpen"
    wide
    :title="dialog.kind === 'create' ? 'Add Provider' : `Edit ${dialog.provider.name}`"
    description="The base URL is what the Protocol's path is appended to: /chat/completions for openai-chat, /v1/messages for anthropic-messages."
  >
    <form class="form" @submit.prevent="saveProvider">
      <div class="form__grid">
        <label class="field"
          ><span class="field__label">Name</span
          ><input v-model="form.name" class="text-input" required
        /></label>
        <label class="field"
          ><span class="field__label">Slug</span
          ><input
            v-model="form.slug"
            class="text-input"
            pattern="[a-z0-9-]+"
            title="Lowercase letters, digits and dashes"
            :disabled="dialog.kind === 'edit'"
            required
        /></label>
        <div class="field">
          <span class="field__label">Protocol</span>
          <AppSelect v-model="form.protocol" :options="protocolOptions" aria-label="Protocol" />
        </div>
        <div class="field">
          <span class="field__label">Authentication</span>
          <AppSelect
            v-model="form.authStyle"
            :options="authStyleOptions"
            aria-label="Authentication"
          />
        </div>
      </div>
      <label class="field"
        ><span class="field__label">Base URL</span
        ><input v-model="form.baseUrl" class="text-input" type="url" required
      /></label>
      <template v-if="form.protocol === 'openai-chat'">
        <div class="field">
          <span class="field__label">Reasoning content in history</span>
          <AppSelect
            v-model="form.reasoningContentInHistory"
            :options="reasoningOptions"
            aria-label="Reasoning content in history"
          />
        </div>
        <fieldset class="check-group">
          <label class="check-field"
            ><input v-model="form.acceptsCacheControl" type="checkbox" /> Accepts cache_control
            markers</label
          >
          <label class="check-field"
            ><input v-model="form.acceptsPromptCacheKey" type="checkbox" /> Accepts
            prompt_cache_key</label
          >
          <label class="check-field"
            ><input v-model="form.usesMaxCompletionTokens" type="checkbox" /> Wants
            max_completion_tokens</label
          >
        </fieldset>
      </template>
      <label v-if="form.protocol === 'anthropic-messages'" class="field"
        ><span class="field__label">Cache marker limit</span
        ><input
          v-model.number="form.cacheMarkerLimit"
          class="text-input"
          type="number"
          min="0"
          step="1"
          placeholder="4"
      /></label>
      <p v-if="form.protocol === 'anthropic-messages'" class="form__hint">
        How many cache markers the gateway may add to a request. 0 adds none; blank means 4.
      </p>
      <p v-if="dialog.kind === 'edit' && dialog.provider.isFromCatalog" class="form__hint">
        From the Catalog. Your edits are kept: seeding never overwrites an existing Provider.
      </p>
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="closeDialog">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">
          {{ dialog.kind === "create" ? "Add Provider" : "Save" }}
        </button>
      </div>
    </form>
  </AppDialog>

  <AppDialog
    v-if="dialog?.kind === 'delete'"
    v-model:open="isDialogOpen"
    title="Delete Provider"
    :description="`${dialog.provider.name} is deleted with its Provider Accounts and Upstream Models. This can't be undone.`"
  >
    <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
    <div class="dialog__actions">
      <button class="button" type="button" @click="closeDialog">Cancel</button>
      <button
        class="button button--danger"
        type="button"
        :disabled="isSaving"
        @click="deleteProvider(dialog.provider)"
      >
        Delete Provider
      </button>
    </div>
  </AppDialog>
</template>
