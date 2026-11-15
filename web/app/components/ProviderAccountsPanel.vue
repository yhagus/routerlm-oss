<script setup lang="ts">
import { KeyRound, Pencil, Plus, Power, Trash2 } from "@lucide/vue";
import { resetCountdown } from "~/lib/quotaMeters";
import {
  MIN_PROVIDER_ACCOUNT_KEY_LENGTH,
  optionalNumber,
  type Provider,
  type ProviderAccount,
} from "~/lib/upstream";

/** A Provider's accounts (API keys), with adding, editing, switching and deleting. */
const props = defineProps<{
  provider: Provider;
  accounts: ProviderAccount[];
  refresh: () => Promise<unknown>;
  /** The accounts haven't arrived yet: placeholder rows instead of the empty state. */
  isLoading?: boolean;
}>();

type ProviderAccountDialog =
  | { kind: "create" }
  | { kind: "edit"; account: ProviderAccount }
  | { kind: "delete"; account: ProviderAccount };

const { $dashboardApi } = useNuxtApp();

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

/** Only Providers with a quota reader have Quota Meters, Exhausted accounts and the Credits toggle. */
const hasQuota = computed(() => props.provider.quotaReader !== null);

const COUNTDOWN_TICK_MS = 30_000;
/** What countdowns and "Checked … ago" count from; ticks while the panel is shown. */
const now = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  countdownTimer = setInterval(() => (now.value = Date.now()), COUNTDOWN_TICK_MS);
});
onUnmounted(() => clearInterval(countdownTimer));

type AccountStatusKind = "exhausted" | "cooldown" | "ready" | "disabled";

/** Where the account stands for routing, with when that ends for a Cooldown. */
interface AccountStatus {
  kind: AccountStatusKind;
  note: string | null;
}

const STATUS_LABELS: Record<AccountStatusKind, string> = {
  exhausted: "Exhausted",
  cooldown: "Cooling down",
  ready: "Ready",
  disabled: "Disabled",
};
const STATUS_BADGE_CLASSES: Record<AccountStatusKind, string> = {
  exhausted: "status-badge--bad",
  cooldown: "status-badge--warn",
  ready: "status-badge--good",
  disabled: "status-badge--warn",
};

/** Exhausted is a Cooldown caused by a run-out Quota Meter: it ends when the meter resets. */
function accountStatus(account: ProviderAccount): AccountStatus {
  if (!account.isEnabled) return { kind: "disabled", note: account.disabledReason };
  const endsAt = account.cooldownEndsAt ? new Date(account.cooldownEndsAt) : null;
  if (!endsAt || endsAt.getTime() <= now.value) return { kind: "ready", note: null };
  if (account.cooldownCause === "exhausted") {
    return { kind: "exhausted", note: resetCountdown(account.cooldownEndsAt, now.value) };
  }
  return { kind: "cooldown", note: `until ${timeFormat.format(endsAt)}` };
}

const accountRows = computed(() =>
  [...props.accounts]
    .sort(
      (first, second) => first.priority - second.priority || first.name.localeCompare(second.name),
    )
    .map((account) => ({ account, status: accountStatus(account) })),
);

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
} = useEditableList<ProviderAccountDialog>("/provider-accounts", props.refresh);

interface ProviderAccountForm {
  name: string;
  key: string;
  /** A number, or "" when the input is empty. */
  priority: number | string;
  continueWhenExhausted: boolean;
}

const EMPTY_FORM: ProviderAccountForm = {
  name: "",
  key: "",
  priority: 0,
  continueWhenExhausted: false,
};

const form = ref<ProviderAccountForm>({ ...EMPTY_FORM });

function openDialog(next: ProviderAccountDialog): void {
  showDialog(next);
  if (next.kind === "create") form.value = { ...EMPTY_FORM };
  if (next.kind === "edit") {
    const { name, priority, continueWhenExhausted } = next.account;
    form.value = { name, key: "", priority, continueWhenExhausted };
  }
}

async function saveAccount(): Promise<void> {
  const current = dialog.value;
  if (!current || current.kind === "delete") return;
  // Only Providers with a quota reader show the toggle; the others keep the stored value.
  const quotaFields = hasQuota.value
    ? { continueWhenExhausted: form.value.continueWhenExhausted }
    : {};
  const fields = {
    name: form.value.name,
    priority: optionalNumber(form.value.priority) ?? 0,
    ...quotaFields,
  };
  const failureMessage = "Couldn't save the Provider Account.";
  if (current.kind === "create") {
    // An empty name leaves it out: the backend makes one up from two constellations.
    const name = form.value.name.trim();
    let addedName = name;
    await submitDialog(
      async () => {
        const created = await $dashboardApi<Pick<ProviderAccount, "name">>("/provider-accounts", {
          method: "POST",
          body: {
            providerId: props.provider.id,
            key: form.value.key,
            priority: fields.priority,
            ...quotaFields,
            ...(name ? { name } : {}),
          },
        });
        addedName = created.name;
        form.value.key = "";
      },
      () => `Added ${addedName}`,
      failureMessage,
    );
    return;
  }
  // An empty key field keeps the stored key.
  const key = form.value.key === "" ? {} : { key: form.value.key };
  await submitDialog(
    async () => {
      await $dashboardApi(`/provider-accounts/${current.account.id}`, {
        method: "PATCH",
        body: { ...fields, ...key },
      });
      form.value.key = "";
    },
    `Saved ${fields.name}`,
    failureMessage,
  );
}

function deleteAccount(account: ProviderAccount): Promise<void> {
  return deleteRow(account, account.name, "Couldn't delete the Provider Account.");
}

function toggleAccount(account: ProviderAccount): Promise<void> {
  return toggleRow(account, account.name);
}
</script>

<template>
  <section class="panel table-panel">
    <div class="panel-heading">
      <div>
        <h2>Accounts</h2>
        <p>The healthy account with the lowest priority number serves first.</p>
      </div>
      <div class="panel-heading__tools">
        <button
          class="button button--primary"
          type="button"
          @click="openDialog({ kind: 'create' })"
        >
          <Plus :size="14" /> Add Account
        </button>
      </div>
    </div>
    <div class="table-wrap">
      <table v-if="accountRows.length || isLoading" class="compact-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Key</th>
            <th>Priority</th>
            <th>Status</th>
            <th v-if="hasQuota">Quota</th>
            <th>Last error</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <LoadingRow v-if="isLoading" :columns="hasQuota ? 7 : 6" />
          <tr v-for="{ account, status } in accountRows" :key="account.id">
            <td>
              <strong>{{ account.name }}</strong>
            </td>
            <td class="tabular">…{{ account.keyLastFour }}</td>
            <td class="tabular">{{ account.priority }}</td>
            <td>
              <span class="status-badge" :class="STATUS_BADGE_CLASSES[status.kind]">{{
                STATUS_LABELS[status.kind]
              }}</span>
              <span v-if="status.note" class="cell-note tabular">{{ status.note }}</span>
              <span v-if="hasQuota && account.continueWhenExhausted" class="cell-note"
                >Continues on Credits when exhausted</span
              >
            </td>
            <td v-if="hasQuota">
              <ProviderAccountQuota :account="account" :now="now" :refresh="refresh" />
            </td>
            <td class="compact-table__wrap">
              <template v-if="account.lastError">
                {{ account.lastError }}
                <span v-if="account.lastErrorAt" class="cell-note tabular">{{
                  dateTimeFormat.format(new Date(account.lastErrorAt))
                }}</span>
              </template>
              <template v-else>—</template>
            </td>
            <td>
              <div class="row-actions provider-table__actions">
                <button
                  class="icon-action"
                  type="button"
                  :aria-label="`Edit ${account.name}`"
                  title="Edit"
                  @click="openDialog({ kind: 'edit', account })"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="icon-action"
                  type="button"
                  :aria-label="`${account.isEnabled ? 'Disable' : 'Enable'} ${account.name}`"
                  :title="account.isEnabled ? 'Disable' : 'Enable'"
                  @click="toggleAccount(account)"
                >
                  <Power :size="14" />
                </button>
                <button
                  class="icon-action icon-action--danger"
                  type="button"
                  :aria-label="`Delete ${account.name}`"
                  title="Delete"
                  @click="openDialog({ kind: 'delete', account })"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else :icon="KeyRound">
        <strong>No accounts yet.</strong
        ><span>Add an API key for {{ provider.name }} so the gateway can call it.</span>
      </EmptyState>
    </div>
  </section>

  <AppDialog
    v-if="dialog && dialog.kind !== 'delete'"
    v-model:open="isDialogOpen"
    :title="
      dialog.kind === 'create' ? `Add ${provider.name} account` : `Edit ${dialog.account.name}`
    "
    description="The key is encrypted before it is stored. The dashboard only ever shows its last four characters."
  >
    <!--
      Not a sign-in form: browsers and password managers must not fill it. The key is a
      masked text input, because a password input makes browsers offer saved logins
      whatever `autocomplete` says.
    -->
    <form
      class="form"
      autocomplete="off"
      data-1p-ignore
      data-lpignore="true"
      data-bwignore
      data-form-type="other"
      @submit.prevent="saveAccount"
    >
      <label class="field"
        ><span class="field__label">{{
          dialog.kind === "create" ? "Name (optional)" : "Name"
        }}</span
        ><input
          v-model="form.name"
          class="text-input"
          name="provider-account-label"
          autocomplete="off"
          spellcheck="false"
          :required="dialog.kind === 'edit'"
          :placeholder="
            dialog.kind === 'create' ? 'Left empty, one is made up, like Lyra Orion' : ''
          "
      /></label>
      <label class="field"
        ><span class="field__label">{{
          dialog.kind === "create" ? "API key" : "New API key (optional)"
        }}</span
        ><input
          v-model="form.key"
          class="text-input text-input--masked"
          type="text"
          name="provider-account-secret"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :minlength="MIN_PROVIDER_ACCOUNT_KEY_LENGTH"
          :required="dialog.kind === 'create'"
          :placeholder="dialog.kind === 'edit' ? `Keeps …${dialog.account.keyLastFour}` : ''"
      /></label>
      <label class="field"
        ><span class="field__label">Priority (lower runs first)</span
        ><NumberInput v-model="form.priority" class="text-input" whole :min="0"
      /></label>
      <label v-if="hasQuota" class="check-field"
        ><input v-model="form.continueWhenExhausted" type="checkbox" /> Continue on Credits when
        exhausted</label
      >
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="closeDialog">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">
          {{ dialog.kind === "create" ? "Add Account" : "Save" }}
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
      <button class="button" type="button" @click="closeDialog">Cancel</button>
      <button
        class="button button--danger"
        type="button"
        :disabled="isSaving"
        @click="deleteAccount(dialog.account)"
      >
        Delete Account
      </button>
    </div>
  </AppDialog>
</template>
