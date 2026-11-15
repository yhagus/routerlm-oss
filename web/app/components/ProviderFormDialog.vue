<script setup lang="ts">
import { apiErrorMessage } from "~/lib/api";
import {
  type AuthStyle,
  type Provider,
  type ProviderQuirks,
  PROTOCOL_OPTIONS,
  REASONING_CONTENT_IN_HISTORY,
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
  /** Blank means the default (four). */
  cacheMarkerLimit: number | string;
}

function formFor(provider: Provider | undefined): ProviderForm {
  return {
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

const form = ref<ProviderForm>(formFor(props.provider));
const isSaving = ref(false);
const error = ref("");

watch(isOpen, (open) => {
  if (!open) return;
  form.value = formFor(props.provider);
  error.value = "";
});

/** The quirks this form has fields for. */
const FORM_QUIRK_KEYS = [
  "reasoningContentInHistory",
  "acceptsCacheControl",
  "acceptsPromptCacheKey",
  "usesMaxCompletionTokens",
  "cacheMarkerLimit",
] as const satisfies readonly (keyof ProviderQuirks)[];

/**
 * The quirks to save: the form's, plus the ones an edited Provider carries
 * that the form has no field for (how a Catalog Provider reasons, which error
 * codes mean Exhausted, where its quota is read), which an edit must not drop.
 */
function quirksToSave(): ProviderQuirks {
  const keptQuirks: ProviderQuirks = { ...props.provider?.quirks };
  for (const key of FORM_QUIRK_KEYS) delete keptQuirks[key];
  return { ...keptQuirks, ...quirksFromForm() };
}

/** Only the form's quirks that are set; the backend rejects unknown keys. */
function quirksFromForm(): ProviderQuirks {
  if (form.value.protocol === "anthropic-messages") {
    const limit = form.value.cacheMarkerLimit;
    return limit === "" ? {} : { cacheMarkerLimit: Number(limit) };
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

async function save(): Promise<void> {
  // No `oauthLogin`: the form doesn't edit it, and a PATCH keeps what it leaves out.
  const fields = {
    name: form.value.name,
    protocol: form.value.protocol,
    baseUrl: form.value.baseUrl,
    authStyle: form.value.authStyle,
    quirks: quirksToSave(),
  };
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
    <form class="form" @submit.prevent="save">
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
            :disabled="Boolean(provider)"
            required
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
