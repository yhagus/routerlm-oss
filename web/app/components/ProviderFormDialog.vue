<script setup lang="ts">
import { apiErrorMessage } from "~/lib/api";
import { REASONING_EFFORTS, SERVICE_TIER_LABELS, SERVICE_TIERS } from "~/lib/parameterPolicy";
import { PROVIDER_LOGOS } from "~/lib/providerLogos";
import { TERMS_RISK_HINT } from "~/lib/upstream";
import {
  chatProtocolOf,
  providerFieldsFromForm,
  providerFormFor,
  slugFromName,
} from "~/lib/providerForm";
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
} from "~/lib/upstream";

/**
 * Adds a Provider (no `provider`) or edits one. Emits `saved` after a
 * successful write, once the dialog has closed and toasted.
 */
const props = defineProps<{ provider?: Provider }>();
const emit = defineEmits<{ saved: [] }>();
const isOpen = defineModel<boolean>("open", { required: true });

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();

const authStyleOptions = [
  { label: "Authorization: Bearer", value: "bearer" },
  { label: "x-api-key header", value: "x-api-key" },
] satisfies { label: string; value: AuthStyle }[];
const reasoningOptions = [
  { label: "Not needed", value: "" },
  { label: "Every assistant turn", value: "all-assistant-turns" },
  { label: "Turns with tool calls", value: "tool-call-turns" },
];
const oauthLoginFlowOptions = [
  { label: "None", value: "" },
  ...OAUTH_LOGIN_FLOWS.map((flow) => ({ label: OAUTH_LOGIN_FLOW_LABELS[flow], value: flow })),
];
const logoOptions = [
  { label: "None (automatic)", value: "" },
  ...[...PROVIDER_LOGOS].map(([key, mark]) => ({ label: mark.label, value: key })),
];

const form = ref(providerFormFor(props.provider));
/** A new Provider's slug follows its name until the slug is typed by hand. */
const isSlugTyped = ref(false);
/** The slug still follows the name: a new Provider whose slug nobody has typed in. */
const isSlugAuto = computed(() => !props.provider && !isSlugTyped.value);
const isSaving = ref(false);
const error = ref("");

/** The quirks below follow the chat endpoint's Protocol; "" hides them all. */
const chatProtocol = computed(() => chatProtocolOf(form.value));
/** Both OpenAI Protocols take a prompt cache key; only Chat Completions has the other request fields. */
const isOpenAiProtocol = computed(
  () => chatProtocol.value === "openai-chat" || chatProtocol.value === "openai-responses",
);
/** What the logo and the quota reader fall back to: the chat endpoint's base URL, else the first. */
const formBaseUrl = computed(() => mainBaseUrl(form.value.endpoints));

watch(isOpen, (open) => {
  if (!open) return;
  form.value = providerFormFor(props.provider);
  isSlugTyped.value = false;
  error.value = "";
});

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function handleNameInput(event: Event): void {
  form.value.name = inputValue(event);
  if (props.provider || isSlugTyped.value) return;
  form.value.slug = slugFromName(form.value.name);
}

/** Clearing the slug hands it back to the name. */
function handleSlugInput(event: Event): void {
  form.value.slug = inputValue(event);
  isSlugTyped.value = form.value.slug !== "";
}

/**
 * The browser can't point at a required field hidden in the closed Advanced
 * section, so a field that fails validation opens it first.
 */
function handleInvalidField(event: Event): void {
  if (!(event.target instanceof HTMLElement)) return;
  const section = event.target.closest("details");
  if (section) section.open = true;
}

async function save(): Promise<void> {
  if (form.value.credentialKinds.length === 0) {
    error.value = "Pick at least one credential its Provider Accounts may hold.";
    return;
  }
  const fields = providerFieldsFromForm(form.value);
  isSaving.value = true;
  error.value = "";
  try {
    if (props.provider) {
      await $dashboardApi(`/providers/${props.provider.id}`, { method: "PATCH", body: fields });
    } else {
      await $dashboardApi("/providers", {
        method: "POST",
        body: { slug: form.value.slug, ...fields },
      });
    }
    showToast(`${props.provider ? "Saved" : "Added"} ${fields.name}`);
    isOpen.value = false;
    emit("saved");
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
    wide
    :title="provider ? `Edit ${provider.name}` : 'Add Provider'"
    description="One endpoint per Kind the Provider serves. Its base URL is what the Protocol's path is appended to: /chat/completions for Chat Completions, /v1/messages for Messages, /responses for Responses."
  >
    <form class="form" @submit.prevent="save" @invalid.capture="handleInvalidField">
      <div class="form__grid">
        <label class="field"
          ><span class="field__label">Name</span
          ><span class="field__with-mark">
            <ProviderLogo
              class="provider-mark--sm"
              :logo="form.logo || null"
              :name="form.name"
              :base-url="formBaseUrl"
            />
            <input :value="form.name" class="text-input" required @input="handleNameInput" /> </span
        ></label>
        <label class="field"
          ><span class="field__label">Slug{{ isSlugAuto ? " (auto)" : "" }}</span
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
      <p v-if="!provider" class="form__hint">
        {{
          isSlugAuto
            ? "Slug is generated from the name. Type in it to set your own."
            : "Slug is set by hand. Clear it to follow the name again."
        }}
      </p>
      <ProviderEndpointsField v-model="form.endpoints" />
      <p class="form__hint">The quirks below follow the chat endpoint's Protocol.</p>
      <div class="field">
        <span class="field__label">Authentication</span>
        <AppSelect v-model="form.authStyle" :options="authStyleOptions" label="Authentication" />
      </div>
      <div class="field">
        <span class="field__label">Logo</span>
        <AppSelect
          v-model="form.logo"
          :options="logoOptions"
          label="Logo"
          searchable
          menu-class="logo-select-menu"
        >
          <template #option-leading="{ option }">
            <ProviderLogo
              class="provider-mark--xs"
              :logo="option.value || null"
              :name="form.name"
              :base-url="formBaseUrl"
            />
          </template>
        </AppSelect>
      </div>
      <p class="form__hint">Automatic picks a logo by the base URL's host, or shows initials.</p>
      <label class="check-field"
        ><input v-model="form.termsRisk" type="checkbox" /> Terms risk</label
      >
      <p class="form__hint">{{ TERMS_RISK_HINT }}</p>
      <div v-if="chatProtocol === 'openai-chat'" class="field">
        <span class="field__label">Reasoning content in history</span>
        <AppSelect
          v-model="form.reasoningContentInHistory"
          :options="reasoningOptions"
          label="Reasoning content in history"
        />
      </div>
      <fieldset v-if="isOpenAiProtocol" class="check-group">
        <legend class="field__label">Request fields</legend>
        <label v-if="chatProtocol === 'openai-chat'" class="check-field"
          ><input v-model="form.acceptsCacheControl" type="checkbox" /> cache_control markers</label
        >
        <label class="check-field"
          ><input v-model="form.acceptsPromptCacheKey" type="checkbox" /> prompt_cache_key</label
        >
        <label v-if="chatProtocol === 'openai-chat'" class="check-field"
          ><input v-model="form.usesMaxCompletionTokens" type="checkbox" />
          max_completion_tokens</label
        >
        <template v-if="chatProtocol === 'openai-responses'">
          <label class="check-field"
            ><input v-model="form.includesEncryptedReasoning" type="checkbox" /> include encrypted
            reasoning</label
          >
          <label class="check-field"
            ><input v-model="form.systemAsDeveloperMessage" type="checkbox" /> System prompt as a
            developer message</label
          >
          <label class="check-field"
            ><input v-model="form.alwaysStreams" type="checkbox" /> Always stream upstream</label
          >
        </template>
      </fieldset>
      <fieldset v-if="chatProtocol === 'openai-responses'" class="check-group">
        <legend class="field__label">Dropped parameters</legend>
        <label v-for="parameter in DROPPABLE_PARAMETERS" :key="parameter" class="check-field"
          ><input v-model="form.droppedParameters" type="checkbox" :value="parameter" />
          {{ parameter }}</label
        >
      </fieldset>
      <p v-if="chatProtocol === 'openai-responses'" class="form__hint">
        Left out of every request, for a Provider that refuses them.
      </p>
      <label v-if="chatProtocol === 'anthropic-messages'" class="field"
        ><span class="field__label">Cache marker limit</span
        ><NumberInput
          v-model="form.cacheMarkerLimit"
          class="text-input"
          whole
          :min="0"
          placeholder="4"
      /></label>
      <p v-if="chatProtocol === 'anthropic-messages'" class="form__hint">
        How many cache markers the gateway may add to a request. 0 adds none; blank means 4.
      </p>

      <details class="form-advanced">
        <summary class="form-advanced__summary">Advanced</summary>
        <div class="form-advanced__body">
          <template v-if="chatProtocol === 'openai-chat'">
            <fieldset class="check-group">
              <legend class="field__label">Reasoning as thinking</legend>
              <label class="check-field"
                ><input v-model="form.hasReasoningAsThinking" type="checkbox" /> Send reasoning as a
                thinking object</label
              >
            </fieldset>
            <p class="form__hint">
              For Providers that refuse reasoning_effort and take
              <code>{ type: "enabled", effort }</code> instead. Give the Provider's name for each
              reasoning effort.
            </p>
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
              <p class="form__hint">
                These get thinking with no effort, by their id at the Provider.
              </p>
            </template>
          </template>
          <template v-if="chatProtocol === 'openai-chat'">
            <div class="field">
              <span class="field__label">Forwarded client headers</span>
              <TagListInput
                v-model="form.forwardedClientHeaders"
                label="Forwarded client headers"
                placeholder="Lowercase header name, then Enter"
              />
            </div>
            <p class="form__hint">
              Request headers passed on to the Provider when the client sent them, such as
              user-agent. Credentials and connection headers are rejected on save.
            </p>
            <ProviderFixedHeadersField v-model="form.fixedHeaders" />
            <p class="form__hint">
              Sent on every request to this Provider. The credential always wins.
            </p>
          </template>
          <template v-if="isOpenAiProtocol">
            <fieldset class="check-group">
              <legend class="field__label">Client fields</legend>
              <label class="check-field"
                ><input v-model="form.forwardsClientPromptCacheKey" type="checkbox" /> Forward the
                client's prompt_cache_key</label
              >
            </fieldset>
            <p class="form__hint">
              Passed on as the client sent it; the gateway adds none of its own.
            </p>
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
          <p class="form__hint">
            What the Provider calls each Service Tier in service_tier, such as priority for fast.
            Blank means the Provider has no such tier.
          </p>

          <div class="field">
            <span class="field__label">Exhausted error codes</span>
            <TagListInput
              v-model="form.exhaustedErrorCodes"
              label="Exhausted error codes"
              placeholder="Code, then Enter"
            />
          </div>
          <p class="form__hint">
            Errors that mean a Provider Account's plan quota ran out: it becomes Exhausted instead
            of going into Cooldown. Digits are read as a status code, anything else as an error code
            or type.
          </p>

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
          <p v-if="form.quotaReader" class="form__hint">
            Blank reads the quota from the base URL's host.
          </p>

          <fieldset class="check-group">
            <legend class="field__label">Credentials</legend>
            <label v-for="kind in CREDENTIAL_KINDS" :key="kind" class="check-field"
              ><input v-model="form.credentialKinds" type="checkbox" :value="kind" />
              {{ CREDENTIAL_KIND_LABELS[kind] }}</label
            >
          </fieldset>
          <p class="form__hint">
            What its Provider Accounts may hold. An OAuth Login also needs a sign-in flow below.
          </p>

          <div class="field">
            <span class="field__label">OAuth Login</span>
            <AppSelect
              v-model="form.oauthLoginFlow"
              :options="oauthLoginFlowOptions"
              label="OAuth Login"
            />
          </div>
          <p class="form__hint">
            Each sign-in flow is built into the gateway; pick the one the Provider shares.
          </p>
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
        </div>
      </details>

      <p v-if="provider?.isFromCatalog" class="form__hint">
        From the Catalog. Your edits are kept: seeding never overwrites an existing Provider.
      </p>
      <p v-if="error" class="form__error" role="alert">{{ error }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="isOpen = false">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">
          {{ provider ? "Save" : "Add Provider" }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
