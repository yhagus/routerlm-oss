<script setup lang="ts">
// Port of v1 AddApiKeyModal — single + bulk API-key add with validation,
// provider-specific fields (regions, cookie),
// compatible-endpoint default model, and proxy-pool selection.
import { computed, reactive, ref, watch } from "vue";
import { api } from "@/lib/api";
import type { ProxyPool } from "@/types/api";
import { providerMeta } from "@/lib/providerMeta";
import { planBulkAdd } from "@/lib/bulkAdd";
import Modal from "@/components/ui/modal.vue";
import Button from "@/components/ui/button.vue";
import Combobox from "@/components/ui/combobox.vue";
import Input from "@/components/ui/input.vue";
import Badge from "@/components/ui/badge.vue";
import Select from "@/components/ui/select.vue";

const NONE_PROXY_POOL_VALUE = "__none__";

const props = defineProps<{
  open: boolean;
  provider: string;
  providerName: string;
  isCompatible: boolean;
  isAnthropic: boolean;
  proxyPools: ProxyPool[];
  error: string;
  existingNames: string[];
}>();
const emit = defineEmits<{
  close: [];
  save: [formData: Record<string, unknown>];
  bulkDone: [];
}>();

const meta = computed(() => providerMeta(props.provider));
const authType = computed(() => meta.value.authType || "apikey");
const isCookie = computed(() => authType.value === "cookie");
const isAutoclaw = computed(() => props.provider === "autoclaw");
const providerRegions = computed(() => meta.value.regions || null);
const regionOptions = computed(() =>
  (providerRegions.value || []).map((regionOption) => ({
    value: regionOption.id,
    label: regionOption.label,
  })),
);
const proxyPoolOptions = computed(() => [
  { value: NONE_PROXY_POOL_VALUE, label: "None" },
  ...props.proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
]);
const credentialLabel = computed(() =>
  isCookie.value ? "Cookie Value" : isAutoclaw.value ? "Refresh Token" : "API Key",
);
const credentialPlaceholder = computed(() =>
  isCookie.value
    ? props.provider === "grok-web"
      ? "sso=xxxxx... or just the raw value"
      : "eyJhbGciOi..."
    : isAutoclaw.value
      ? "Paste your AutoClaw refresh token"
      : "",
);

const form = reactive({
  name: "",
  apiKey: "",
  defaultModel: "",
  priority: 1,
  proxyPoolId: NONE_PROXY_POOL_VALUE,
});
const region = ref(
  meta.value.defaultRegion || Object.keys(meta.value.regions || {})[0] || "",
);
const validating = ref(false);
const validationResult = ref<"success" | "failed" | null>(null);
const saving = ref(false);
const mode = ref<"single" | "bulk">("single");
const bulkText = ref("");
const bulkResult = ref<{ success: number; failed: number } | null>(null);
const bulkPlaceholder = "name1|sk-key1\nname2|sk-key2\nsk-key-only-auto-named";

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    Object.assign(form, {
      name: "",
      apiKey: "",
      defaultModel: "",
      priority: 1,
      proxyPoolId: NONE_PROXY_POOL_VALUE,
    });
    region.value =
      meta.value.defaultRegion ||
      Object.keys(meta.value.regions || {})[0] ||
      "";
    validationResult.value = null;
    bulkResult.value = null;
    bulkText.value = "";
    mode.value = "single";
  },
);

function buildProviderSpecificData(): Record<string, unknown> | undefined {
  if (providerRegions.value && region.value) return { region: region.value };
  return undefined;
}

async function handleValidate() {
  validating.value = true;
  try {
    const result = await api.providers.validate({
      provider: props.provider,
      apiKey: form.apiKey,
      providerSpecificData: buildProviderSpecificData(),
    });
    validationResult.value = result.valid ? "success" : "failed";
  } catch {
    validationResult.value = "failed";
  } finally {
    validating.value = false;
  }
}

const canSubmit = computed(() => {
  if (!form.apiKey) return false;
  if (!form.name) return false;
  if (props.isCompatible && !form.defaultModel.trim()) return false;
  return true;
});

async function handleSubmit() {
  if (!props.provider || saving.value || !canSubmit.value) return;
  saving.value = true;
  try {
    let isValid = false;
    validating.value = true;
    validationResult.value = null;
    try {
      const result = await api.providers.validate({
        provider: props.provider,
        apiKey: form.apiKey,
        providerSpecificData: buildProviderSpecificData(),
      });
      isValid = Boolean(result.valid);
      validationResult.value = isValid ? "success" : "failed";
    } catch {
      validationResult.value = "failed";
    } finally {
      validating.value = false;
    }

    emit("save", {
      name: form.name,
      apiKey: form.apiKey,
      defaultModel: props.isCompatible ? form.defaultModel.trim() : undefined,
      priority: form.priority,
      proxyPoolId:
        form.proxyPoolId === NONE_PROXY_POOL_VALUE ? null : form.proxyPoolId,
      testStatus: isValid ? "active" : "unknown",
      providerSpecificData: buildProviderSpecificData(),
    });
  } finally {
    saving.value = false;
  }
}

async function handleBulkSubmit() {
  const lines = bulkText.value.split("\n");
  if (!lines.length || saving.value) return;
  const plan = planBulkAdd(lines, props.existingNames);
  if (!plan.length) return;
  saving.value = true;
  bulkResult.value = null;
  let success = 0;
  let failed = 0;
  for (const entry of plan) {
    try {
      await api.providers.create({
        provider: props.provider,
        apiKey: entry.apiKey,
        name: entry.name,
        priority: 1,
        testStatus: "unknown",
      });
      success++;
    } catch {
      failed++;
    }
  }
  saving.value = false;
  bulkResult.value = { success, failed };
  if (success > 0) emit("bulkDone");
}
</script>

<template>
  <Modal
    :open="open"
    :title="`Add ${providerName || provider} ${credentialLabel}`"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <div class="flex gap-2">
        <Button
          size="sm"
          :variant="mode === 'single' ? 'default' : 'ghost'"
          @click="
            mode = 'single';
            bulkResult = null;
          "
          >Single</Button
        >
        <Button
          size="sm"
          :variant="mode === 'bulk' ? 'default' : 'ghost'"
          @click="
            mode = 'bulk';
            bulkResult = null;
          "
          >Bulk Add</Button
        >
      </div>

      <div v-if="mode === 'bulk'" class="flex flex-col gap-3">
        <p class="text-xs text-muted-foreground">
          One key per line. Format:
          <code>name|apiKey</code>
          or just <code>apiKey</code> (auto-named by index).
        </p>
        <textarea
          v-model="bulkText"
          class="min-h-[140px] w-full resize-y rounded border border-accent/30 bg-sidebar p-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          :placeholder="bulkPlaceholder"
        />
        <p
          v-if="bulkResult"
          class="text-sm font-medium"
          :class="bulkResult.failed > 0 ? 'text-yellow-500' : 'text-green-500'"
        >
          ✓ {{ bulkResult.success }} added<template v-if="bulkResult.failed > 0"
            >, ✗ {{ bulkResult.failed }} failed</template
          >
        </p>
        <div class="flex gap-2">
          <Button
            class="flex-1"
            :disabled="saving || !bulkText.trim()"
            @click="handleBulkSubmit"
            >{{ saving ? "Adding..." : "Add All Keys" }}</Button
          >
          <Button class="flex-1" variant="ghost" @click="emit('close')"
            >Cancel</Button
          >
        </div>
      </div>

      <template v-else>
        <div class="space-y-2">
          <label class="text-sm font-medium" for="add-key-name">Name</label>
          <Input
            id="add-key-name"
            v-model="form.name"
            placeholder="Production Key"
          />
        </div>
        <div class="flex gap-2">
          <div class="flex-1 space-y-2">
            <label class="text-sm font-medium" for="add-key-secret">{{
              credentialLabel
            }}</label>
            <Input
              id="add-key-secret"
              v-model="form.apiKey"
              :type="isCookie ? 'text' : 'password'"
              :placeholder="credentialPlaceholder"
            />
          </div>
          <div class="pt-6">
            <Button
              variant="secondary"
              :disabled="!form.apiKey || validating || saving"
              @click="handleValidate"
              >{{ validating ? "Checking..." : "Check" }}</Button
            >
          </div>
        </div>
        <div v-if="isAutoclaw" class="space-y-2">
          <p class="text-xs text-muted-foreground">
            Paste your AutoClaw refresh token. LobakAI refreshes the session
            against autoglm-api.autoglm.ai and routes requests upstream directly.
          </p>
        </div>
        <p
          v-if="isCookie && meta.authHint"
          class="text-xs text-muted-foreground"
        >
          {{ meta.authHint }}
          <a
            v-if="meta.website"
            :href="meta.website"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline"
            >Open {{ meta.website.replace(/^https?:\/\//, "") }}</a
          >
        </p>
        <div v-if="providerRegions" class="space-y-2">
          <label class="text-sm font-medium" for="add-key-region">Region</label>
          <Select
            id="add-key-region"
            v-model="region"
            :options="regionOptions"
          />
        </div>
        <div v-if="isCompatible" class="space-y-2">
          <label class="text-sm font-medium" for="add-key-model"
            >Default Model</label
          >
          <Input
            id="add-key-model"
            v-model="form.defaultModel"
            :placeholder="
              isAnthropic ? 'claude-3-5-sonnet-latest' : 'gpt-4o-mini'
            "
          />
        </div>
        <Badge
          v-if="validationResult"
          :variant="validationResult === 'success' ? 'success' : 'destructive'"
          >{{ validationResult === "success" ? "Valid" : "Invalid" }}</Badge
        >
        <p v-if="error" class="break-words text-xs text-red-500">{{ error }}</p>
        <p v-if="isCompatible" class="text-xs text-muted-foreground">
          Enter the model ID exactly as your compatible endpoint expects it.
          This model will be saved as the connection default.
        </p>

        <div class="space-y-2">
          <label class="text-sm font-medium" for="add-key-priority"
            >Priority</label
          >
          <Input
            id="add-key-priority"
            v-model.number="form.priority"
            type="number"
            min="0"
          />
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium" for="add-key-proxy"
            >Proxy Pool</label
          >
          <Combobox
            id="add-key-proxy"
            v-model="form.proxyPoolId"
            :options="proxyPoolOptions"
            placeholder="Search proxy pools..."
            empty-text="No proxy pools available"
          />
        </div>
        <p v-if="!proxyPools.length" class="text-xs text-muted-foreground">
          No active proxy pools available. Create one in Proxy Pools page first.
        </p>
        <p class="text-xs text-muted-foreground">
          Legacy manual proxy fields are still accepted by API for backward
          compatibility.
        </p>

        <div class="flex gap-2">
          <Button
            class="flex-1"
            :disabled="saving || !canSubmit"
            @click="handleSubmit"
            >{{ saving ? "Saving..." : "Save" }}</Button
          >
          <Button class="flex-1" variant="ghost" @click="emit('close')"
            >Cancel</Button
          >
        </div>
      </template>
    </div>
  </Modal>
</template>
