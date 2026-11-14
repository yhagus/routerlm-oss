<script setup lang="ts">
import { Pencil, Plus, Power, Trash2, Wallet } from "@lucide/vue";
import { computed, ref } from "vue";
import { apiErrorMessage } from "~/lib/api";
import {
  MIN_PROVIDER_ACCOUNT_KEY_LENGTH,
  optionalNumber,
  type Provider,
  type ProviderAccount,
} from "~/lib/upstream";

useHead({ title: "Provider Accounts" });

type ProviderAccountDialog =
  | { kind: "create" }
  | { kind: "edit"; account: ProviderAccount }
  | { kind: "delete"; account: ProviderAccount };

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const [{ data: accounts, error: loadError, refresh }, { data: providers, error: providersError }] =
  await Promise.all([
    useDashboardApi<ProviderAccount[]>("/provider-accounts"),
    useDashboardApi<Provider[]>("/providers"),
  ]);

const providerNameById = computed(
  () => new Map((providers.value ?? []).map((provider) => [provider.id, provider.name])),
);
const providerOptions = computed(() =>
  (providers.value ?? []).map((provider) => ({ label: provider.name, value: provider.id })),
);
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const dialog = ref<ProviderAccountDialog | null>(null);
const isDialogOpen = computed({
  get: () => dialog.value !== null,
  set: (isOpen) => {
    if (!isOpen) dialog.value = null;
  },
});
const isSaving = ref(false);
const dialogError = ref("");

interface ProviderAccountForm {
  providerId: string;
  name: string;
  key: string;
  /** A number, or "" when the input is empty. */
  priority: number | string;
}

const form = ref<ProviderAccountForm>({ providerId: "", name: "", key: "", priority: 0 });

function openDialog(next: ProviderAccountDialog): void {
  dialog.value = next;
  dialogError.value = "";
  if (next.kind === "create") {
    form.value = {
      providerId: providerOptions.value[0]?.value ?? "",
      name: "",
      key: "",
      priority: 0,
    };
  }
  if (next.kind === "edit") {
    const { providerId, name, priority } = next.account;
    form.value = { providerId, name, key: "", priority };
  }
}

async function saveAccount(): Promise<void> {
  const current = dialog.value;
  if (!current || current.kind === "delete") return;
  isSaving.value = true;
  dialogError.value = "";
  const fields = { name: form.value.name, priority: optionalNumber(form.value.priority) ?? 0 };
  try {
    if (current.kind === "create") {
      await $dashboardApi("/provider-accounts", {
        method: "POST",
        body: { providerId: form.value.providerId, key: form.value.key, ...fields },
      });
      showToast(`Added ${fields.name}`);
    } else {
      // An empty key field keeps the stored key.
      const key = form.value.key === "" ? {} : { key: form.value.key };
      await $dashboardApi(`/provider-accounts/${current.account.id}`, {
        method: "PATCH",
        body: { ...fields, ...key },
      });
      showToast(`Saved ${fields.name}`);
    }
    form.value.key = "";
    dialog.value = null;
    await refresh();
  } catch (error) {
    dialogError.value = apiErrorMessage(error, "Couldn't save the Provider Account.");
  } finally {
    isSaving.value = false;
  }
}

async function deleteAccount(account: ProviderAccount): Promise<void> {
  isSaving.value = true;
  dialogError.value = "";
  try {
    await $dashboardApi(`/provider-accounts/${account.id}`, { method: "DELETE" });
    showToast(`Deleted ${account.name}`);
    dialog.value = null;
    await refresh();
  } catch (error) {
    dialogError.value = apiErrorMessage(error, "Couldn't delete the Provider Account.");
  } finally {
    isSaving.value = false;
  }
}

async function toggleAccount(account: ProviderAccount): Promise<void> {
  try {
    await $dashboardApi(`/provider-accounts/${account.id}`, {
      method: "PATCH",
      body: { isEnabled: !account.isEnabled },
    });
    showToast(`${account.isEnabled ? "Disabled" : "Enabled"} ${account.name}`);
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't update ${account.name}.`));
  }
}
</script>

<template>
  <PageHeading
    title="Provider Accounts"
    description="The API keys the gateway holds at each Provider. Within a Provider, the healthy account with the lowest priority number serves first."
  >
    <button
      class="button button--primary"
      type="button"
      :disabled="providerOptions.length === 0"
      @click="openDialog({ kind: 'create' })"
    >
      <Plus :size="14" /> Add Provider Account
    </button>
  </PageHeading>

  <section class="panel table-panel">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Provider Account</th>
            <th>Provider</th>
            <th>Key</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Last error</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="account in accounts" :key="account.id">
            <td>
              <div class="table-entity">
                <span class="key-icon"><Wallet :size="15" /></span
                ><strong>{{ account.name }}</strong>
              </div>
            </td>
            <td>{{ providerNameById.get(account.providerId) ?? "—" }}</td>
            <td class="tabular">…{{ account.keyLastFour }}</td>
            <td class="tabular">{{ account.priority }}</td>
            <td>
              <span
                class="status-badge"
                :class="account.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
                >{{ account.isEnabled ? "Enabled" : "Disabled" }}</span
              >
              <span v-if="account.disabledReason" class="cell-note">{{
                account.disabledReason
              }}</span>
            </td>
            <td>
              <template v-if="account.lastError">
                {{ account.lastError }}
                <span v-if="account.lastErrorAt" class="cell-note tabular">{{
                  dateTimeFormat.format(new Date(account.lastErrorAt))
                }}</span>
              </template>
              <template v-else>—</template>
            </td>
            <td>
              <div class="row-actions">
                <button class="row-action" @click="openDialog({ kind: 'edit', account })">
                  <Pencil :size="14" /> Edit
                </button>
                <button class="row-action" @click="toggleAccount(account)">
                  <Power :size="14" /> {{ account.isEnabled ? "Disable" : "Enable" }}
                </button>
                <button class="row-action" @click="openDialog({ kind: 'delete', account })">
                  <Trash2 :size="14" /> Delete
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="loadError || providersError" class="empty-state">
        <strong>Couldn't load Provider Accounts.</strong
        ><span>Check that the backend is running, then reload the page.</span>
      </div>
      <div v-else-if="accounts?.length === 0" class="empty-state">
        <strong>No Provider Accounts yet.</strong
        ><span>Add an API key for a Provider so the gateway can call it.</span>
      </div>
    </div>
  </section>

  <AppDialog
    v-if="dialog && dialog.kind !== 'delete'"
    v-model:open="isDialogOpen"
    :title="dialog.kind === 'create' ? 'Add Provider Account' : `Edit ${dialog.account.name}`"
    description="The key is encrypted before it is stored. The dashboard only ever shows its last four characters."
  >
    <form class="form" autocomplete="off" @submit.prevent="saveAccount">
      <div class="field">
        <span class="field__label">Provider</span>
        <AppSelect
          v-if="dialog.kind === 'create'"
          v-model="form.providerId"
          :options="providerOptions"
          aria-label="Provider"
        />
        <input v-else class="text-input" :value="providerNameById.get(form.providerId)" disabled />
      </div>
      <label class="field"
        ><span class="field__label">Name</span
        ><input v-model="form.name" class="text-input" required
      /></label>
      <label class="field"
        ><span class="field__label">{{
          dialog.kind === "create" ? "API key" : "New API key (optional)"
        }}</span
        ><input
          v-model="form.key"
          class="text-input"
          type="password"
          autocomplete="off"
          :minlength="MIN_PROVIDER_ACCOUNT_KEY_LENGTH"
          :required="dialog.kind === 'create'"
          :placeholder="dialog.kind === 'edit' ? `Keeps …${dialog.account.keyLastFour}` : ''"
      /></label>
      <label class="field"
        ><span class="field__label">Priority (lower runs first)</span
        ><input v-model="form.priority" class="text-input" type="number" min="0" step="1"
      /></label>
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="dialog = null">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">
          {{ dialog.kind === "create" ? "Add Provider Account" : "Save" }}
        </button>
      </div>
    </form>
  </AppDialog>

  <AppDialog
    v-if="dialog?.kind === 'delete'"
    v-model:open="isDialogOpen"
    title="Delete Provider Account"
    :description="`${dialog.account.name} and its stored key are deleted. Past Usage Logs keep their totals. This can't be undone.`"
  >
    <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
    <div class="dialog__actions">
      <button class="button" type="button" @click="dialog = null">Cancel</button>
      <button
        class="button button--danger"
        type="button"
        :disabled="isSaving"
        @click="deleteAccount(dialog.account)"
      >
        Delete Provider Account
      </button>
    </div>
  </AppDialog>
</template>
