<script setup lang="ts">
import { Copy, ExternalLink } from '@lucide/vue';
import { useTimeoutPoll } from '@vueuse/core';
import { apiErrorMessage } from '~/lib/api';
import { isNotFound } from '~/lib/errors';
import {
  OAUTH_REGION_LABELS,
  OAUTH_REGIONS,
  type OauthRegion,
  type OauthSignIn,
  type PendingOauthSignIn,
  type Provider,
  type ProviderAccount,
} from '~/lib/upstream';

const props = defineProps<{ provider: Provider; account: ProviderAccount | null }>();
const emit = defineEmits<{ completed: [account: ProviderAccount] }>();
const isOpen = defineModel<boolean>('open', { required: true });

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();

const SIGN_INS_PATH = '/provider-accounts/sign-ins';
const POLL_INTERVAL_MS = 2000;
const WEB_ADDRESS = /^https?:\/\//i;

type SignInState =
  | { step: 'start' }
  | { step: 'pending'; signIn: PendingOauthSignIn }
  | { step: 'ended'; outcome: 'denied' | 'expired' };

const REGION_DESCRIPTION =
  'Choose where the account is registered. Each region signs in on its own page.';
const START_DESCRIPTION = 'Asking the Provider for a sign-in code.';

const DESCRIPTIONS: Record<Exclude<SignInState['step'], 'start'>, string> = {
  pending: 'Approve the sign-in on the verification page. This dialog finishes on its own.',
  ended: 'Nothing was saved. Start again to get a new code.',
};

const OUTCOME_MESSAGES = {
  denied: 'The sign-in was denied on the verification page.',
  expired: 'The code expired before the sign-in was approved.',
} as const;

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

const state = shallowRef<SignInState>({ step: 'start' });
const isStarting = ref(false);
const error = ref('');

let isAbandoned = false;
onBeforeUnmount(() => {
  isAbandoned = true;
});

const poll = useTimeoutPoll(readSignIn, POLL_INTERVAL_MS, { immediate: false });

const title = computed(() => {
  if (props.account) return `Sign in again: ${props.account.name}`;
  return `Sign in with ${props.provider.name}`;
});

const regionAuthHosts = computed(() => {
  const oauthLogin = props.provider.oauthLogin;
  return oauthLogin?.flow === 'kimi-code' ? oauthLogin.authHosts : null;
});

const regionHint = computed(() => {
  const hosts = regionAuthHosts.value;
  if (!hosts) return '';
  return `Global accounts sign in at ${hosts.global}, Chinese accounts at ${hosts.china}.`;
});

const canRetryStart = computed(
  () =>
    state.value.step === 'start' &&
    !regionAuthHosts.value &&
    !isStarting.value &&
    error.value !== '',
);

const description = computed(() => {
  const { step } = state.value;
  if (step !== 'start') return DESCRIPTIONS[step];
  return regionAuthHosts.value ? REGION_DESCRIPTION : START_DESCRIPTION;
});

const verificationUrl = computed(() => {
  const current = state.value;
  if (current.step !== 'pending') return null;
  const { verificationUri, verificationUriComplete } = current.signIn;
  const url = verificationUriComplete ?? verificationUri;
  return WEB_ADDRESS.test(url) ? url : null;
});

const waitingNote = computed(() => {
  const current = state.value;
  if (current.step !== 'pending') return '';
  const expiresAt = timeFormat.format(new Date(current.signIn.expiresAt));
  return `Waiting for approval. The code expires at ${expiresAt}.`;
});

async function startSignIn(region?: OauthRegion): Promise<void> {
  isStarting.value = true;
  error.value = '';
  try {
    const signIn = await $dashboardApi<PendingOauthSignIn>(SIGN_INS_PATH, {
      method: 'POST',
      body: {
        providerId: props.provider.id,
        ...(region ? { region } : {}),
        ...(props.account ? { providerAccountId: props.account.id } : {}),
      },
    });
    if (isAbandoned) return;
    state.value = { step: 'pending', signIn };
    poll.resume();
  } catch (caught) {
    error.value = apiErrorMessage(caught, "Couldn't start the sign-in.");
  } finally {
    isStarting.value = false;
  }
}

async function readSignIn(): Promise<void> {
  const pending = state.value;
  if (pending.step !== 'pending') return;
  try {
    const signIn = await $dashboardApi<OauthSignIn>(`${SIGN_INS_PATH}/${pending.signIn.id}`);
    if (isAbandoned || state.value !== pending) return;
    error.value = '';
    if (signIn.status === 'pending') return;
    poll.pause();
    if (signIn.status === 'completed') {
      emit('completed', signIn.providerAccount);
      return;
    }
    state.value = { step: 'ended', outcome: signIn.status };
  } catch (caught) {
    if (isAbandoned || state.value !== pending) return;
    if (isNotFound(caught)) {
      poll.pause();
      state.value = { step: 'ended', outcome: 'expired' };
      return;
    }
    error.value = apiErrorMessage(caught, "Couldn't check the sign-in. Trying again.");
  }
}

function startAgain(): void {
  error.value = '';
  state.value = { step: 'start' };
  if (!regionAuthHosts.value) void startSignIn();
}

onMounted(() => {
  if (!regionAuthHosts.value) void startSignIn();
});

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    showToast('Sign-in code copied');
  } catch {
    showToast("Couldn't copy. Select the code and copy it yourself.");
  }
}

function selectAll(event: FocusEvent): void {
  if (event.target instanceof HTMLInputElement) event.target.select();
}
</script>

<template>
  <AppDialog v-model:open="isOpen" :title="title" :description="description">
    <template v-if="state.step === 'start' && regionAuthHosts">
      <div class="sign-in__regions" role="group" aria-label="Account region">
        <button
          v-for="region in OAUTH_REGIONS"
          :key="region"
          class="button"
          type="button"
          :disabled="isStarting"
          @click="startSignIn(region)"
        >
          {{ OAUTH_REGION_LABELS[region] }}
        </button>
      </div>
      <AppSpinner v-if="isStarting" label="Starting the sign-in…" />
      <p v-else-if="regionHint" class="form__hint">{{ regionHint }}</p>
    </template>
    <AppSpinner v-else-if="state.step === 'start' && isStarting" label="Starting the sign-in…" />
    <template v-else-if="state.step === 'pending'">
      <div class="key-reveal">
        <input
          class="text-input key-reveal__value tabular"
          type="text"
          :value="state.signIn.userCode"
          aria-label="Sign-in code"
          readonly
          @focus="selectAll"
        />
        <button class="button" type="button" @click="copyCode(state.signIn.userCode)">
          <Copy :size="14" /> Copy
        </button>
      </div>
      <a
        v-if="verificationUrl"
        class="button button--primary sign-in__link"
        :href="verificationUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLink :size="14" /> Open verification page
      </a>
      <p v-if="!verificationUrl || !state.signIn.verificationUriComplete" class="form__hint">
        Enter the code at {{ state.signIn.verificationUri }}
      </p>
      <AppSpinner :label="waitingNote" />
    </template>
    <p v-else-if="state.step === 'ended'" class="form__error" role="alert">
      {{ OUTCOME_MESSAGES[state.outcome] }}
    </p>
    <p v-if="error" class="form__error" role="alert">{{ error }}</p>
    <div class="dialog__actions">
      <button class="button" type="button" @click="isOpen = false">
        {{ state.step === 'ended' ? 'Close' : 'Cancel' }}
      </button>
      <button
        v-if="state.step === 'ended'"
        class="button button--primary"
        type="button"
        @click="startAgain"
      >
        Start again
      </button>
      <button
        v-else-if="canRetryStart"
        class="button button--primary"
        type="button"
        @click="startAgain"
      >
        Try again
      </button>
    </div>
  </AppDialog>
</template>
