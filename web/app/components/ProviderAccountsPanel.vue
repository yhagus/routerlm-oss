<script setup lang="ts">
import { KeyRound, LogIn, Pencil, Plus, Power, Trash2 } from '@lucide/vue';
import { concurrencyLimitLabel, MAX_CONCURRENCY_LIMIT } from '~/lib/concurrencyLimit';
import { resetCountdown, usageResetCount } from '~/lib/quotaMeters';
import {
  acceptsApiKey,
  AUTO_PLAN_CHOICE,
  MIN_PROVIDER_ACCOUNT_KEY_LENGTH,
  needsNewSignIn,
  OAUTH_REGION_LABELS,
  offersPlanChoice,
  offersSignIn,
  optionalNumber,
  planChoiceOptions,
  type Provider,
  type ProviderAccount,
} from '~/lib/upstream';

const props = defineProps<{
  provider: Provider;
  accounts: ProviderAccount[];
  refresh: () => Promise<unknown>;
  isLoading?: boolean;
}>();

type ProviderAccountDialog =
  | { kind: 'create' }
  | { kind: 'edit'; account: ProviderAccount }
  | { kind: 'delete'; account: ProviderAccount }
  | { kind: 'sign-in'; account: ProviderAccount | null };

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

const hasQuota = computed(() => props.provider.quotaReader !== null);
const hasPlanReader = computed(() => props.provider.planReader !== null);
const hasPlanChoice = computed(() => offersPlanChoice(props.provider));
const hasPlanColumn = computed(() => hasPlanReader.value || hasPlanChoice.value);
const columnCount = computed(() => 6 + Number(hasQuota.value) + Number(hasPlanColumn.value));

const COUNTDOWN_TICK_MS = 30_000;
const now = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  countdownTimer = setInterval(() => (now.value = Date.now()), COUNTDOWN_TICK_MS);
});
onUnmounted(() => clearInterval(countdownTimer));

type AccountStatusKind = 'exhausted' | 'cooldown' | 'ready' | 'disabled';

interface AccountStatus {
  kind: AccountStatusKind;
  note: string | null;
}

const STATUS_BADGES: Record<AccountStatusKind, { label: string; badgeClass: string }> = {
  exhausted: { label: 'Exhausted', badgeClass: 'status-badge--bad' },
  cooldown: { label: 'Cooling down', badgeClass: 'status-badge--warn' },
  ready: { label: 'Ready', badgeClass: 'status-badge--good' },
  disabled: { label: 'Disabled', badgeClass: 'status-badge--warn' },
};

function accountStatus(account: ProviderAccount): AccountStatus {
  if (!account.isEnabled) return { kind: 'disabled', note: account.disabledReason };
  const endsAt = account.cooldownEndsAt ? new Date(account.cooldownEndsAt) : null;
  if (!endsAt || endsAt.getTime() <= now.value) return { kind: 'ready', note: null };
  if (account.cooldownCause === 'exhausted') {
    return { kind: 'exhausted', note: resetCountdown(account.cooldownEndsAt, now.value) };
  }
  return { kind: 'cooldown', note: `until ${timeFormat.format(endsAt)}` };
}

function oauthLoginNote(account: ProviderAccount): string | null {
  if (account.oauthRegion) return OAUTH_REGION_LABELS[account.oauthRegion];
  const identity = [account.oauthEmail, account.plan].filter(Boolean);
  return identity.length > 0 ? identity.join(' · ') : null;
}

function accountCredential(account: ProviderAccount): { label: string; note: string | null } {
  if (account.credentialKind === 'oauth-login') {
    return { label: 'OAuth Login', note: oauthLoginNote(account) };
  }
  return { label: 'API key', note: account.keyLastFour ? `…${account.keyLastFour}` : null };
}

const accountRows = computed(() =>
  [...props.accounts]
    .sort(
      (first, second) => first.priority - second.priority || first.name.localeCompare(second.name),
    )
    .map((account) => ({
      account,
      status: accountStatus(account),
      credential: accountCredential(account),
    })),
);

function addAccountHint(provider: Provider): string {
  const canAddKey = acceptsApiKey(provider);
  const canSignIn = offersSignIn(provider);
  if (canAddKey && canSignIn) return 'Add an API key or sign in';
  if (canSignIn) return 'Sign in';
  return 'Add an API key';
}

const emptyStateHint = computed(
  () => `${addAccountHint(props.provider)} for ${props.provider.name} so the gateway can call it.`,
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
} = useEditableList<ProviderAccountDialog>('/provider-accounts', props.refresh);

interface ProviderAccountForm {
  name: string;
  key: string;
  priority: number | string;
  concurrencyLimit: number | string;
  continueWhenExhausted: boolean;
  paysBeyondPlan: boolean;
  planChoice: string;
}

const EMPTY_FORM: ProviderAccountForm = {
  name: '',
  key: '',
  priority: 0,
  concurrencyLimit: '',
  continueWhenExhausted: false,
  paysBeyondPlan: false,
  planChoice: AUTO_PLAN_CHOICE,
};

const form = ref<ProviderAccountForm>({ ...EMPTY_FORM });

function openDialog(next: ProviderAccountDialog): void {
  showDialog(next);
  if (next.kind === 'create') form.value = { ...EMPTY_FORM };
  if (next.kind === 'edit') {
    const { name, priority, concurrencyLimit, continueWhenExhausted, paysBeyondPlan, planChoice } =
      next.account;
    form.value = {
      name,
      key: '',
      priority,
      concurrencyLimit: concurrencyLimit ?? '',
      continueWhenExhausted,
      paysBeyondPlan,
      planChoice,
    };
  }
}

const planSelectOptions = computed(() => {
  const options = planChoiceOptions(props.provider);
  const current = dialog.value;
  if (current?.kind !== 'edit') return options;
  const savedChoice = current.account.planChoice;
  if (options.some((option) => option.value === savedChoice)) return options;
  return [...options, { label: `${savedChoice} (no longer listed)`, value: savedChoice }];
});

const editsOauthLogin = computed(() => {
  const current = dialog.value;
  return current?.kind === 'edit' && current.account.credentialKind === 'oauth-login';
});

const accountDialogDescription = computed(() => {
  if (editsOauthLogin.value) {
    return 'This Provider Account holds an OAuth Login, which the gateway keeps valid. The login itself is never shown.';
  }
  return 'The key is encrypted before it is stored. The dashboard only ever shows its last four characters.';
});

function deleteDescription(account: ProviderAccount): string {
  const credential = account.credentialKind === 'oauth-login' ? 'OAuth Login' : 'key';
  return `${account.name} and its stored ${credential} are deleted. Past Usage Logs keep their totals. This can't be undone.`;
}

async function saveAccount(): Promise<void> {
  const current = dialog.value;
  if (!current || current.kind === 'delete' || current.kind === 'sign-in') return;
  const quotaFields = hasQuota.value
    ? { continueWhenExhausted: form.value.continueWhenExhausted }
    : {};
  const planFields = hasPlanReader.value ? { paysBeyondPlan: form.value.paysBeyondPlan } : {};
  const planChoiceFields = hasPlanChoice.value ? { planChoice: form.value.planChoice } : {};
  const fields = {
    name: form.value.name,
    priority: optionalNumber(form.value.priority) ?? 0,
    ...quotaFields,
    ...planFields,
  };
  const failureMessage = "Couldn't save the Provider Account.";
  if (current.kind === 'create') {
    const name = form.value.name.trim();
    let addedName = name;
    await submitDialog(
      async () => {
        const created = await $dashboardApi<Pick<ProviderAccount, 'name'>>('/provider-accounts', {
          method: 'POST',
          body: {
            providerId: props.provider.id,
            key: form.value.key,
            priority: fields.priority,
            concurrencyLimit: optionalNumber(form.value.concurrencyLimit),
            ...quotaFields,
            ...planFields,
            ...planChoiceFields,
            ...(name ? { name } : {}),
          },
        });
        addedName = created.name;
        form.value.key = '';
      },
      () => `Added ${addedName}`,
      failureMessage,
    );
    return;
  }
  const key = form.value.key === '' ? {} : { key: form.value.key };
  const changedPlanChoice =
    form.value.planChoice === current.account.planChoice ? {} : planChoiceFields;
  const concurrencyLimit = optionalNumber(form.value.concurrencyLimit);
  const changedConcurrencyLimit =
    concurrencyLimit === current.account.concurrencyLimit ? {} : { concurrencyLimit };
  await submitDialog(
    async () => {
      await $dashboardApi(`/provider-accounts/${current.account.id}`, {
        method: 'PATCH',
        body: { ...fields, ...key, ...changedPlanChoice, ...changedConcurrencyLimit },
      });
      form.value.key = '';
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

async function handleSignedIn(account: ProviderAccount): Promise<void> {
  const current = dialog.value;
  const isSignInAgain = current?.kind === 'sign-in' && current.account !== null;
  closeDialog();
  showToast(isSignInAgain ? `Signed in again: ${account.name}` : `Added ${account.name}`);
  await props.refresh();
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
          v-if="offersSignIn(provider)"
          class="button"
          type="button"
          @click="openDialog({ kind: 'sign-in', account: null })"
        >
          <LogIn :size="14" /> Sign in with {{ provider.name }}
        </button>
        <button
          v-if="acceptsApiKey(provider)"
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
            <th>Credential</th>
            <th>Priority</th>
            <th>Status</th>
            <th v-if="hasPlanColumn">Plan</th>
            <th v-if="hasQuota">Quota</th>
            <th>Last error</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <LoadingRow v-if="isLoading" :columns="columnCount" />
          <tr v-for="{ account, status, credential } in accountRows" :key="account.id">
            <td>
              <strong>{{ account.name }}</strong>
            </td>
            <td>
              {{ credential.label }}
              <span v-if="credential.note" class="cell-note tabular">{{ credential.note }}</span>
            </td>
            <td class="tabular">
              {{ account.priority }}
              <span v-if="account.concurrencyLimit !== null" class="cell-note"
                >Up to {{ concurrencyLimitLabel(account.concurrencyLimit) }}</span
              >
            </td>
            <td>
              <span class="status-badge" :class="STATUS_BADGES[status.kind].badgeClass">{{
                STATUS_BADGES[status.kind].label
              }}</span>
              <span v-if="status.note" class="cell-note tabular">{{ status.note }}</span>
              <span
                v-if="status.kind === 'exhausted' && account.usageResets?.length"
                class="cell-note"
                >{{ usageResetCount(account.usageResets.length) }} available to use</span
              >
              <span v-if="hasQuota && account.continueWhenExhausted" class="cell-note"
                >Continues on Credits when exhausted</span
              >
              <span v-if="hasPlanReader && account.paysBeyondPlan" class="cell-note"
                >Pays beyond its Plan</span
              >
              <button
                v-if="needsNewSignIn(account)"
                class="text-button"
                type="button"
                :aria-label="`Sign in again on ${account.name}`"
                @click="openDialog({ kind: 'sign-in', account })"
              >
                <LogIn :size="12" /> Sign in again
              </button>
            </td>
            <td v-if="hasPlanColumn">
              <ProviderAccountPlan
                :provider="provider"
                :account="account"
                :now="now"
                :refresh="refresh"
              />
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
        <strong>No accounts yet.</strong><span>{{ emptyStateHint }}</span>
      </EmptyState>
    </div>
  </section>

  <AppDialog
    v-if="dialog?.kind === 'create' || dialog?.kind === 'edit'"
    hide-description
    v-model:open="isDialogOpen"
    :title="
      dialog.kind === 'create' ? `Add ${provider.name} account` : `Edit ${dialog.account.name}`
    "
    :description="accountDialogDescription"
  >
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
          dialog.kind === 'create' ? 'Name (optional)' : 'Name'
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
      <label v-if="!editsOauthLogin" class="field"
        ><span class="field__label">{{
          dialog.kind === 'create' ? 'API key' : 'New API key (optional)'
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
      <label class="field"
        ><span class="field__label">Concurrency Limit</span
        ><NumberInput
          v-model="form.concurrencyLimit"
          class="text-input"
          whole
          :min="1"
          :max="MAX_CONCURRENCY_LIMIT"
          suffix="at once"
          unit-label="Attempts at once"
          placeholder="No limit"
      /></label>
      <label v-if="hasQuota" class="check-field"
        ><input v-model="form.continueWhenExhausted" type="checkbox" /> Continue on Credits when
        exhausted</label
      >
      <div v-if="hasPlanChoice" class="field">
        <span class="field__label">Plan</span>
        <AppSelect v-model="form.planChoice" :options="planSelectOptions" label="Plan" />
      </div>
      <template v-if="hasPlanReader">
        <label class="check-field"
          ><input v-model="form.paysBeyondPlan" type="checkbox" /> Pays beyond plan</label
        >
      </template>
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="closeDialog">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">
          {{ dialog.kind === 'create' ? 'Add Account' : 'Save' }}
        </button>
      </div>
    </form>
  </AppDialog>

  <AppDialog
    v-if="dialog?.kind === 'delete'"
    v-model:open="isDialogOpen"
    title="Delete Provider Account"
    :description="deleteDescription(dialog.account)"
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

  <ProviderAccountSignInDialog
    v-if="dialog?.kind === 'sign-in'"
    v-model:open="isDialogOpen"
    :provider="provider"
    :account="dialog.account"
    @completed="handleSignedIn"
  />
</template>
