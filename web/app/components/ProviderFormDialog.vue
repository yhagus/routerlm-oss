<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api';
import { REASONING_EFFORTS, SERVICE_TIER_LABELS, SERVICE_TIERS } from '~/lib/parameterPolicy';
import { PROVIDER_LOGOS } from '~/lib/providerLogos';
import {
  chatProtocolsOf,
  providerFieldsFromForm,
  providerFormFor,
  slugFromName,
} from '~/lib/providerForm';
import {
  type AuthStyle,
  CREDENTIAL_KIND_LABELS,
  CREDENTIAL_KINDS,
  DROPPABLE_PARAMETERS,
  OAUTH_LOGIN_FLOW_LABELS,
  OAUTH_LOGIN_FLOWS,
  mainBaseUrl,
  type Provider,
  QUOTA_READER_OPTIONS,
} from '~/lib/upstream';

const props = defineProps<{ provider?: Provider }>();
const emit = defineEmits<{ saved: [] }>();
const isOpen = defineModel<boolean>('open', { required: true });

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();

const authStyleOptions = [
  { label: 'Authorization: Bearer', value: 'bearer' },
  { label: 'x-api-key header', value: 'x-api-key' },
] satisfies { label: string; value: AuthStyle }[];
const reasoningOptions = [
  { label: 'Not needed', value: '' },
  { label: 'Every assistant turn', value: 'all-assistant-turns' },
  { label: 'Turns with tool calls', value: 'tool-call-turns' },
];
const oauthLoginFlowOptions = [
  { label: 'None', value: '' },
  ...OAUTH_LOGIN_FLOWS.map((flow) => ({ label: OAUTH_LOGIN_FLOW_LABELS[flow], value: flow })),
];
const logoOptions = [
  { label: 'None (automatic)', value: '' },
  ...[...PROVIDER_LOGOS].map(([key, mark]) => ({ label: mark.label, value: key })),
];

const nameInputId = useId();
const form = ref(providerFormFor(props.provider));
const isSlugTyped = ref(false);
const isSlugAuto = computed(() => !props.provider && !isSlugTyped.value);
const isSaving = ref(false);
const error = ref('');

const chatProtocols = computed(() => chatProtocolsOf(form.value));
const hasOpenAiChat = computed(() => chatProtocols.value.includes('openai-chat'));
const hasOpenAiResponses = computed(() => chatProtocols.value.includes('openai-responses'));
const hasAnthropicMessages = computed(() => chatProtocols.value.includes('anthropic-messages'));
const isOpenAiProtocol = computed(() => hasOpenAiChat.value || hasOpenAiResponses.value);
const formBaseUrl = computed(() => mainBaseUrl(form.value.endpoints));

watch(isOpen, (open) => {
  if (!open) return;
  form.value = providerFormFor(props.provider);
  isSlugTyped.value = false;
  error.value = '';
});

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : '';
}

function handleNameInput(event: Event): void {
  form.value.name = inputValue(event);
  if (props.provider || isSlugTyped.value) return;
  form.value.slug = slugFromName(form.value.name);
}

function handleSlugInput(event: Event): void {
  form.value.slug = inputValue(event);
  isSlugTyped.value = form.value.slug !== '';
}

function handleInvalidField(event: Event): void {
  if (!(event.target instanceof HTMLElement)) return;
  const section = event.target.closest('details');
  if (section) section.open = true;
}

async function save(): Promise<void> {
  if (form.value.credentialKinds.length === 0) {
    error.value = 'Pick at least one credential its Provider Accounts may hold.';
    return;
  }
  const fields = providerFieldsFromForm(form.value);
  isSaving.value = true;
  error.value = '';
  try {
    if (props.provider) {
      await $dashboardApi(`/providers/${props.provider.id}`, { method: 'PATCH', body: fields });
    } else {
      await $dashboardApi('/providers', {
        method: 'POST',
        body: { slug: form.value.slug, ...fields },
      });
    }
    showToast(`${props.provider ? 'Saved' : 'Added'} ${fields.name}`);
    isOpen.value = false;
    emit('saved');
  } catch (caught) {
    error.value = apiErrorMessage(caught, "Couldn't save the Provider.");
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <AppDialog
    v-model:open="isOpen"
    extra-wide
    hide-description
    :title="provider ? `Edit ${provider.name}` : 'Add Provider'"
    description="The Provider's name, endpoints and request quirks."
  >
    <form class="form" @submit.prevent="save" @invalid.capture="handleInvalidField">
      <div class="form__grid">
        <div class="field">
          <label class="field__label" :for="nameInputId">Name</label>
          <span class="field__with-mark">
            <AppSelect
              v-model="form.logo"
              class="logo-picker"
              trigger-class="logo-picker__trigger"
              :options="logoOptions"
              label="Logo"
              searchable
              menu-class="logo-select-menu"
            >
              <template #trigger>
                <ProviderLogo
                  class="provider-mark--sm"
                  :logo="form.logo || null"
                  :name="form.name"
                  :base-url="formBaseUrl"
                />
              </template>
              <template #option-leading="{ option }">
                <ProviderLogo
                  class="provider-mark--xs"
                  :logo="option.value || null"
                  :name="form.name"
                  :base-url="formBaseUrl"
                />
              </template>
            </AppSelect>
            <input
              :id="nameInputId"
              :value="form.name"
              class="text-input"
              required
              @input="handleNameInput"
            />
          </span>
        </div>
        <label class="field"
          ><span class="field__label">Slug{{ isSlugAuto ? ' (auto)' : '' }}</span
          ><input
            :value="form.slug"
            class="text-input"
            pattern="[a-z0-9-]+"
            title="Lowercase letters, digits and dashes"
            :disabled="Boolean(provider)"
            required
            @input="handleSlugInput"
        /></label>
      </div>
      <ProviderEndpointsField v-model="form.endpoints" />
      <div class="field">
        <span class="field__label">Authentication</span>
        <AppSelect v-model="form.authStyle" :options="authStyleOptions" label="Authentication" />
      </div>
      <label v-if="hasAnthropicMessages" class="field"
        ><span class="field__label">Cache marker limit</span
        ><NumberInput
          v-model="form.cacheMarkerLimit"
          class="text-input"
          whole
          :min="0"
          placeholder="4"
      /></label>
      <fieldset v-if="hasOpenAiResponses" class="check-group">
        <legend class="field__label">Dropped parameters</legend>
        <label v-for="parameter in DROPPABLE_PARAMETERS" :key="parameter" class="check-field"
          ><input v-model="form.droppedParameters" type="checkbox" :value="parameter" />
          {{ parameter }}</label
        >
      </fieldset>
      <label class="check-field"
        ><input v-model="form.termsRisk" type="checkbox" /> Terms risk</label
      >

      <details class="form-advanced">
        <summary class="form-advanced__summary">Advanced</summary>
        <div class="form-advanced__body">
          <div v-if="hasOpenAiChat" class="field">
            <span class="field__label">Reasoning content in history</span>
            <AppSelect
              v-model="form.reasoningContentInHistory"
              :options="reasoningOptions"
              label="Reasoning content in history"
            />
          </div>
          <template v-if="hasOpenAiChat">
            <div class="field">
              <span class="field__label">Forwarded client headers</span>
              <TagListInput
                v-model="form.forwardedClientHeaders"
                label="Forwarded client headers"
                placeholder="Lowercase header name, then Enter"
              />
            </div>
            <ProviderFixedHeadersField v-model="form.fixedHeaders" />
          </template>

          <div class="form__grid">
            <label v-for="tier in SERVICE_TIERS" :key="tier" class="field"
              ><span class="field__label">{{ SERVICE_TIER_LABELS[tier] }} tier wire value</span
              ><input
                v-model="form.serviceTierValues[tier]"
                class="text-input"
                spellcheck="false"
                placeholder="Not offered"
            /></label>
          </div>

          <div class="field">
            <span class="field__label">Exhausted error codes</span>
            <TagListInput
              v-model="form.exhaustedErrorCodes"
              label="Exhausted error codes"
              placeholder="Code, then Enter"
            />
          </div>

          <div class="form__grid">
            <div class="field">
              <span class="field__label">Quota reader</span>
              <AppSelect
                v-model="form.quotaReader"
                :options="QUOTA_READER_OPTIONS"
                label="Quota reader"
              />
            </div>
            <label v-if="form.quotaReader" class="field"
              ><span class="field__label">Quota base URL</span
              ><input
                v-model="form.quotaBaseUrl"
                class="text-input"
                type="url"
                :placeholder="formBaseUrl || 'Same as the base URL'"
            /></label>
          </div>

          <div class="field">
            <span class="field__label">OAuth Login</span>
            <AppSelect
              v-model="form.oauthLoginFlow"
              :options="oauthLoginFlowOptions"
              label="OAuth Login"
            />
          </div>
          <div v-if="form.oauthLoginFlow === 'kimi-code'" class="form__grid">
            <label class="field"
              ><span class="field__label">Global auth host</span
              ><input
                v-model="form.kimiCodeOauthLogin.authHosts.global"
                class="text-input"
                type="url"
                required
            /></label>
            <label class="field"
              ><span class="field__label">China auth host</span
              ><input
                v-model="form.kimiCodeOauthLogin.authHosts.china"
                class="text-input"
                type="url"
                required
            /></label>
            <label class="field"
              ><span class="field__label">Client ID</span
              ><input
                v-model="form.kimiCodeOauthLogin.clientId"
                class="text-input"
                required
                spellcheck="false"
            /></label>
            <label class="field"
              ><span class="field__label">CLI version</span
              ><input
                v-model="form.kimiCodeOauthLogin.cliVersion"
                class="text-input"
                required
                spellcheck="false"
            /></label>
          </div>
          <div v-if="form.oauthLoginFlow === 'openai-codex'" class="form__grid">
            <label class="field"
              ><span class="field__label">Issuer</span
              ><input
                v-model="form.openAiCodexOauthLogin.issuer"
                class="text-input"
                type="url"
                required
            /></label>
            <label class="field"
              ><span class="field__label">Client ID</span
              ><input
                v-model="form.openAiCodexOauthLogin.clientId"
                class="text-input"
                required
                spellcheck="false"
            /></label>
            <label class="field"
              ><span class="field__label">Codex CLI version</span
              ><input
                v-model="form.openAiCodexOauthLogin.cliVersion"
                class="text-input"
                required
                spellcheck="false"
            /></label>
          </div>

          <fieldset v-if="isOpenAiProtocol" class="check-group">
            <legend class="field__label">Request fields</legend>
            <label v-if="hasOpenAiChat" class="check-field"
              ><input v-model="form.acceptsCacheControl" type="checkbox" /> cache_control
              markers</label
            >
            <label class="check-field"
              ><input v-model="form.acceptsPromptCacheKey" type="checkbox" />
              prompt_cache_key</label
            >
            <label v-if="hasOpenAiChat" class="check-field"
              ><input v-model="form.usesMaxCompletionTokens" type="checkbox" />
              max_completion_tokens</label
            >
            <template v-if="hasOpenAiResponses">
              <label class="check-field"
                ><input v-model="form.includesEncryptedReasoning" type="checkbox" /> include
                encrypted reasoning</label
              >
              <label class="check-field"
                ><input v-model="form.systemAsDeveloperMessage" type="checkbox" /> System prompt as
                a developer message</label
              >
              <label class="check-field"
                ><input v-model="form.alwaysStreams" type="checkbox" /> Always stream
                upstream</label
              >
            </template>
          </fieldset>
          <fieldset v-if="isOpenAiProtocol" class="check-group">
            <legend class="field__label">Client fields</legend>
            <label class="check-field"
              ><input v-model="form.forwardsClientPromptCacheKey" type="checkbox" /> Forward the
              client's prompt_cache_key</label
            >
          </fieldset>
          <fieldset class="check-group">
            <legend class="field__label">Credentials</legend>
            <label v-for="kind in CREDENTIAL_KINDS" :key="kind" class="check-field"
              ><input v-model="form.credentialKinds" type="checkbox" :value="kind" />
              {{ CREDENTIAL_KIND_LABELS[kind] }}</label
            >
          </fieldset>
          <template v-if="hasOpenAiChat">
            <fieldset class="check-group">
              <legend class="field__label">Reasoning as thinking</legend>
              <label class="check-field"
                ><input v-model="form.hasReasoningAsThinking" type="checkbox" /> Send reasoning as a
                thinking object</label
              >
            </fieldset>
            <template v-if="form.hasReasoningAsThinking">
              <div class="form-advanced__efforts">
                <label v-for="effort in REASONING_EFFORTS" :key="effort" class="field"
                  ><span class="field__label">{{ effort }}</span
                  ><input
                    v-model="form.thinkingEfforts[effort]"
                    class="text-input"
                    required
                    spellcheck="false"
                /></label>
              </div>
              <div class="field">
                <span class="field__label">Upstream Models without effort</span>
                <TagListInput
                  v-model="form.upstreamModelsWithoutEffort"
                  label="Upstream Models without effort"
                  placeholder="Upstream Model id, then Enter"
                />
              </div>
            </template>
          </template>
        </div>
      </details>

      <p v-if="error" class="form__error" role="alert">{{ error }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="isOpen = false">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">
          {{ provider ? 'Save' : 'Add Provider' }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
