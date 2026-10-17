<script setup lang="ts">
// Port of v1 shared/components/EditConnectionModal.js
import { computed, reactive, ref, watch } from "vue";
import { api } from "@/lib/api";
import Badge from "@/components/ui/badge.vue";
import Button from "@/components/ui/button.vue";
import Combobox from "@/components/ui/combobox.vue";
import Input from "@/components/ui/input.vue";
import Modal from "@/components/ui/modal.vue";

const props = defineProps<{
  open: boolean;
  connection: Record<string, any> | null;
  groupOptions?: string[];
}>();

const emit = defineEmits<{
  save: [updates: Record<string, unknown>];
  close: [];
}>();

const formData = reactive({ name: "", priority: 1, apiKey: "", group: "" });
const testing = ref(false);
const testResult = ref<"success" | "failed" | null>(null);
const validating = ref(false);
const validationResult = ref<"success" | "failed" | null>(null);
const saving = ref(false);
const groupOptionsList = computed(() =>
  (props.groupOptions || []).map((group) => ({ value: group, label: group })),
);

watch(
  () => props.connection,
  (connection) => {
    if (!connection) return;
    formData.name = connection.name || "";
    formData.priority = connection.priority || 1;
    formData.apiKey = "";
    formData.group = connection.group || "";
    testResult.value = null;
    validationResult.value = null;
  },
  { immediate: true },
);

const isOAuth = () => props.connection?.authType === "oauth";

async function handleTest() {
  if (!props.connection?.provider) return;
  testing.value = true;
  testResult.value = null;
  try {
    const data = await api.providers.test(props.connection.id);
    testResult.value = data.ok ? "success" : "failed";
  } catch {
    testResult.value = "failed";
  } finally {
    testing.value = false;
  }
}

async function validateKey(): Promise<boolean> {
  validating.value = true;
  validationResult.value = null;
  try {
    const data = await api.providers.validate({
      provider: props.connection!.provider,
      apiKey: formData.apiKey,
    });
    const ok = !!data.valid;
    validationResult.value = ok ? "success" : "failed";
    return ok;
  } catch {
    validationResult.value = "failed";
    return false;
  } finally {
    validating.value = false;
  }
}

async function handleSubmit() {
  if (!props.connection) return;
  saving.value = true;
  try {
    const updates: Record<string, unknown> = {
      name: formData.name,
      priority: formData.priority,
      group: formData.group.trim() || null,
    };
    if (!isOAuth() && formData.apiKey) {
      const isValid =
        validationResult.value === "success" ? true : await validateKey();
      if (isValid) {
        updates.apiKey = formData.apiKey;
        updates.testStatus = "active";
        updates.lastError = null;
        updates.lastErrorAt = null;
      }
    }
    await emit("save", updates);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal
    :open="open && !!connection"
    title="Edit Connection"
    @close="emit('close')"
  >
    <div v-if="connection" class="flex flex-col gap-4">
      <label class="space-y-1.5 block">
        <span class="text-xs font-medium">Name</span>
        <Input
          v-model="formData.name"
          :placeholder="isOAuth() ? 'Account name' : 'Production Key'"
        />
      </label>

      <div
        v-if="isOAuth() && connection.email"
        class="rounded-lg bg-muted/50 p-3"
      >
        <p class="mb-1 text-sm text-muted-foreground">Email</p>
        <p class="font-medium">{{ connection.email }}</p>
      </div>

      <label class="space-y-1.5 block">
        <span class="text-xs font-medium">Priority</span>
        <Input v-model.number="formData.priority" type="number" min="1" />
      </label>

      <label class="space-y-1.5 block">
        <span class="text-xs font-medium">Group</span>
        <Combobox
          v-model="formData.group"
          :options="groupOptionsList"
          allow-custom
          placeholder="Select or enter a group"
          empty-text="No matching groups"
          class="w-full"
        />
        <span class="text-[11px] text-muted-foreground"
          >Optional label to organize accounts within this provider.</span
        >
      </label>

      <template v-if="!isOAuth()">
        <div class="flex items-end gap-2">
          <label class="flex-1 space-y-1.5 block">
            <span class="text-xs font-medium">API Key</span>
            <Input
              v-model="formData.apiKey"
              type="password"
              placeholder="Enter new API key"
            />
            <span class="text-[11px] text-muted-foreground"
              >Leave blank to keep the current API key.</span
            >
          </label>
          <Button
            variant="secondary"
            :disabled="!formData.apiKey || validating || saving"
            @click="validateKey"
          >
            {{ validating ? "Checking..." : "Check" }}
          </Button>
        </div>
        <Badge
          v-if="validationResult"
          :variant="validationResult === 'success' ? 'success' : 'destructive'"
        >
          {{ validationResult === "success" ? "Valid" : "Invalid" }}
        </Badge>
      </template>

      <div class="flex items-center gap-3">
        <Button variant="secondary" :disabled="testing" @click="handleTest">{{
          testing ? "Testing..." : "Test Connection"
        }}</Button>
        <Badge
          v-if="testResult"
          :variant="testResult === 'success' ? 'success' : 'destructive'"
        >
          {{ testResult === "success" ? "Valid" : "Failed" }}
        </Badge>
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
