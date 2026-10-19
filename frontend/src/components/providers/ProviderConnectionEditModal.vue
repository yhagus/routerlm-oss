<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { api } from "@/lib/api";
import type { ProviderConnection, ProxyPool } from "@/types/api";
import { providerMeta } from "@/lib/providerMeta";
import Modal from "@/components/ui/modal.vue";
import Button from "@/components/ui/button.vue";
import Combobox from "@/components/ui/combobox.vue";
import Input from "@/components/ui/input.vue";
import Badge from "@/components/ui/badge.vue";
import Select from "@/components/ui/select.vue";

const props = defineProps<{
  connection: ProviderConnection | null;
  groupOptions: string[];
  proxyPools: ProxyPool[];
}>();
const emit = defineEmits<{
  close: [];
  save: [updates: Record<string, unknown>];
}>();

// maxInFlight is a string so an empty field means "no limit".
const form = reactive({
  name: "",
  priority: 1,
  apiKey: "",
  group: "",
  maxInFlight: "",
});
const region = ref("");
const testing = ref(false);
const testResult = ref<"success" | "failed" | null>(null);
const validating = ref(false);
const validationResult = ref<"success" | "failed" | null>(null);
const saving = ref(false);

function field(name: string): unknown {
  if (!props.connection) return undefined;
  return (
    (props.connection as unknown as Record<string, unknown>)[name] ??
    (props.connection.data as Record<string, unknown> | undefined)?.[name]
  );
}

watch(
  () => props.connection,
  (connection) => {
    if (!connection) return;
    Object.assign(form, {
      name: connection.name || "",
      priority: connection.priority || 1,
      apiKey: "",
      group: String(field("group") || ""),
      maxInFlight:
        Number(field("maxInFlight")) >= 1 ? String(field("maxInFlight")) : "",
    });
    const specific = (field("providerSpecificData") || {}) as Record<
      string,
      unknown
    >;
    const regions = providerMeta(connection.provider).regions;
    if (regions)
      region.value = String(
        specific.region ||
          providerMeta(connection.provider).defaultRegion ||
          Object.keys(regions)[0] ||
          "",
      );
    testResult.value = null;
    validationResult.value = null;
  },
  { immediate: true },
);

const isOAuth = computed(() => props.connection?.authType === "oauth");
const isCompatible = computed(() =>
  Boolean(
    props.connection &&
    (props.connection.apiType || props.connection.data?.apiType),
  ),
);
const providerRegions = computed(() =>
  props.connection
    ? providerMeta(props.connection.provider).regions || null
    : null,
);
const regionOptions = computed(() =>
  (providerRegions.value || []).map((regionOption) => ({
    value: regionOption.id,
    label: regionOption.label,
  })),
);
const groupOptions = computed(() =>
  props.groupOptions.map((group) => ({ value: group, label: group })),
);

function regionSpecificData(): Record<string, unknown> | undefined {
  if (providerRegions.value && region.value)
    return {
      ...((field("providerSpecificData") || {}) as Record<string, unknown>),
      region: region.value,
    };
  return undefined;
}

async function handleTest() {
  if (!props.connection?.provider) return;
  testing.value = true;
  testResult.value = null;
  try {
    const result = await api.providers.test(props.connection.id);
    testResult.value = result.valid ? "success" : "failed";
  } catch {
    testResult.value = "failed";
  } finally {
    testing.value = false;
  }
}

async function handleValidate() {
  if (!props.connection?.provider || !form.apiKey) return;
  validating.value = true;
  validationResult.value = null;
  try {
    const result = await api.providers.validate({
      provider: props.connection.provider,
      apiKey: form.apiKey,
      ...(providerRegions.value
        ? { providerSpecificData: regionSpecificData() }
        : {}),
    });
    validationResult.value = result.valid ? "success" : "failed";
  } catch {
    validationResult.value = "failed";
  } finally {
    validating.value = false;
  }
}

async function handleSubmit() {
  if (!props.connection) return;
  saving.value = true;
  try {
    const updates: Record<string, unknown> = {
      name: form.name,
      priority: form.priority,
      group: form.group.trim() || null,
      maxInFlight: Number(form.maxInFlight) >= 1 ? Number(form.maxInFlight) : null,
    };
    if (!isOAuth.value && form.apiKey) {
      let isValid = validationResult.value === "success";
      if (!isValid) {
        validating.value = true;
        validationResult.value = null;
        try {
          const result = await api.providers.validate({
            provider: props.connection.provider,
            apiKey: form.apiKey,
            ...(providerRegions.value
              ? { providerSpecificData: regionSpecificData() }
              : {}),
          });
          isValid = Boolean(result.valid);
          validationResult.value = isValid ? "success" : "failed";
        } catch {
          validationResult.value = "failed";
        } finally {
          validating.value = false;
        }
      }
      updates.apiKey = form.apiKey;
      if (isValid)
        Object.assign(updates, {
          testStatus: "active",
          lastError: null,
          lastErrorAt: null,
        });
    }
    if (providerRegions.value && region.value)
      updates.providerSpecificData = regionSpecificData();
    await emit("save", updates);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal
    :open="Boolean(connection)"
    title="Edit Connection"
    @close="emit('close')"
  >
    <div v-if="connection" class="flex flex-col gap-4">
      <div class="space-y-2">
        <label class="text-sm font-medium" for="edit-connection-name"
          >Name</label
        >
        <Input
          id="edit-connection-name"
          v-model="form.name"
          :placeholder="isOAuth ? 'Account name' : 'Production Key'"
        />
      </div>
      <div
        v-if="isOAuth && connection.email"
        class="rounded-lg bg-sidebar/50 p-3"
      >
        <p class="mb-1 text-sm text-muted-foreground">Email</p>
        <p class="font-medium">{{ connection.email }}</p>
      </div>
      <div class="space-y-2">
        <label class="text-sm font-medium" for="edit-connection-priority"
          >Priority</label
        >
        <Input
          id="edit-connection-priority"
          v-model.number="form.priority"
          type="number"
          min="0"
        />
      </div>
      <div class="space-y-2">
        <label class="text-sm font-medium" for="edit-connection-group"
          >Group</label
        >
        <Combobox
          id="edit-connection-group"
          v-model="form.group"
          :options="groupOptions"
          allow-custom
          placeholder="Select or enter a group"
          empty-text="No matching groups"
          class="w-full"
        />
        <p class="text-xs text-muted-foreground">
          Optional label to organize accounts within this provider.
        </p>
      </div>

      <div class="space-y-2">
        <label class="text-sm font-medium" for="edit-connection-max-in-flight"
          >Max concurrent</label
        >
        <Input
          id="edit-connection-max-in-flight"
          v-model="form.maxInFlight"
          type="number"
          min="1"
          placeholder="No limit"
        />
        <p class="text-xs text-muted-foreground">
          When this account is full, new requests go to the next account.
          Empty uses the provider default.
        </p>
      </div>

      <template v-if="!isOAuth">
        <div class="flex gap-2">
          <div class="flex-1 space-y-2">
            <label class="text-sm font-medium" for="edit-connection-api-key"
              >API Key</label
            >
            <Input
              id="edit-connection-api-key"
              v-model="form.apiKey"
              type="password"
              placeholder="Enter new API key"
            />
            <p class="text-xs text-muted-foreground">
              Leave blank to keep the current API key.
            </p>
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
        <Badge
          v-if="validationResult"
          :variant="validationResult === 'success' ? 'success' : 'destructive'"
          >{{ validationResult === "success" ? "Valid" : "Invalid" }}</Badge
        >
      </template>

      <div v-if="providerRegions" class="space-y-2">
        <label class="text-sm font-medium" for="edit-connection-region"
          >Region</label
        >
        <Select
          id="edit-connection-region"
          v-model="region"
          :options="regionOptions"
        />
      </div>

      <div v-if="!isCompatible" class="flex items-center gap-3">
        <Button variant="secondary" :disabled="testing" @click="handleTest">{{
          testing ? "Testing..." : "Test Connection"
        }}</Button>
        <Badge
          v-if="testResult"
          :variant="testResult === 'success' ? 'success' : 'destructive'"
          >{{ testResult === "success" ? "Valid" : "Failed" }}</Badge
        >
      </div>

      <div class="flex gap-2">
        <Button class="flex-1" :disabled="saving" @click="handleSubmit">{{
          saving ? "Saving..." : "Save"
        }}</Button>
        <Button class="flex-1" variant="ghost" @click="emit('close')"
          >Cancel</Button
        >
      </div>
    </div>
  </Modal>
</template>
