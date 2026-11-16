<script setup lang="ts">
import { apiErrorMessage } from "~/lib/api";
import { REASONING_EFFORTS } from "~/lib/parameterPolicy";
import { PROVIDER_LOGOS } from "~/lib/providerLogos";
import { providerFieldsFromForm, providerFormFor, slugFromName } from "~/lib/providerForm";
import {
  type AuthStyle,
  type Provider,
  PROTOCOL_OPTIONS,
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
const logoOptions = [
  { label: "None (automatic)", value: "" },
  ...[...PROVIDER_LOGOS].map(([key, mark]) => ({ label: mark.label, value: key })),
];

const form = ref(providerFormFor(props.provider));
/** A new Provider's slug follows its name until the slug is typed by hand. */
const isSlugTyped = ref(false);
const isSaving = ref(false);
const error = ref("");

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
    description="The base URL is what the Protocol's path is appended to: /chat/completions for Chat Completions, /v1/messages for Messages."
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
              :base-url="form.baseUrl"
            />
            <input :value="form.name" class="text-input" required @input="handleNameInput" /> </span
        ></label>
        <label class="field"
          ><span class="field__label">Slug</span
          ><input
            :value="form.slug"
            class="text-input"
            pattern="[a-z0-9-]+"
            title="Lowercase letters, digits and dashes"
            :disabled="Boolean(provider)"
            required
            @input="handleSlugInput"
        /></label>
        <div class="field">
          <span class="field__label">Protocol</span>
          <AppSelect v-model="form.protocol" :options="PROTOCOL_OPTIONS" label="Protocol" />
        </div>
        <div class="field">
          <span class="field__label">Authentication</span>
          <AppSelect v-model="form.authStyle" :options="authStyleOptions" label="Authentication" />
        </div>
      </div>
      <label class="field"
        ><span class="field__label">Base URL</span
        ><input v-model="form.baseUrl" class="text-input" type="url" required
      /></label>
      <div class="field">
        <span class="field__label">Logo</span>
        <AppSelect
          v-model="form.logo"
          :options="logoOptions"
          label="Logo"
          searchable
          menu-class="logo-select-menu"
        />
      </div>
      <p class="form__hint">Automatic picks a logo by the base URL's host, or shows initials.</p>
      <template v-if="form.protocol === 'openai-chat'">
        <div class="field">
          <span class="field__label">Reasoning content in history</span>
          <AppSelect
            v-model="form.reasoningContentInHistory"
            :options="reasoningOptions"
            label="Reasoning content in history"
          />
        </div>
        <fieldset class="check-group">
          <legend class="field__label">Request fields</legend>
          <label class="check-field"
            ><input v-model="form.acceptsCacheControl" type="checkbox" /> cache_control
            markers</label
          >
          <label class="check-field"
            ><input v-model="form.acceptsPromptCacheKey" type="checkbox" /> prompt_cache_key</label
          >
          <label class="check-field"
            ><input v-model="form.usesMaxCompletionTokens" type="checkbox" />
            max_completion_tokens</label
          >
        </fieldset>
      </template>
      <label v-if="form.protocol === 'anthropic-messages'" class="field"
        ><span class="field__label">Cache marker limit</span
        ><NumberInput
          v-model="form.cacheMarkerLimit"
          class="text-input"
          whole
          :min="0"
          placeholder="4"
      /></label>
      <p v-if="form.protocol === 'anthropic-messages'" class="form__hint">
        How many cache markers the gateway may add to a request. 0 adds none; blank means 4.
      </p>

      <details class="form-advanced">
        <summary class="form-advanced__summary">Advanced</summary>
        <div class="form-advanced__body">
          <template v-if="form.protocol === 'openai-chat'">
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
                :placeholder="form.baseUrl || 'Same as the base URL'"
            /></label>
          </div>
          <p v-if="form.quotaReader" class="form__hint">
            Blank reads the quota from the base URL's host.
          </p>

          <fieldset class="check-group">
            <legend class="field__label">OAuth Login</legend>
            <label class="check-field"
              ><input v-model="form.hasOauthLogin" type="checkbox" /> Provider Accounts can sign
              in</label
            >
          </fieldset>
          <p class="form__hint">
            Sign-in follows Kimi Code's device-code flow, so it only works for Providers that share
            it.
          </p>
          <div v-if="form.hasOauthLogin" class="form__grid">
            <label class="field"
              ><span class="field__label">Global auth host</span
              ><input
                v-model="form.oauthLogin.authHosts.global"
                class="text-input"
                type="url"
                required
            /></label>
            <label class="field"
              ><span class="field__label">China auth host</span
              ><input
                v-model="form.oauthLogin.authHosts.china"
                class="text-input"
                type="url"
                required
            /></label>
            <label class="field"
              ><span class="field__label">Client ID</span
              ><input
                v-model="form.oauthLogin.clientId"
                class="text-input"
                required
                spellcheck="false"
            /></label>
            <label class="field"
              ><span class="field__label">CLI version</span
              ><input
                v-model="form.oauthLogin.cliVersion"
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
