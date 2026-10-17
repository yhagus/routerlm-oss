<script setup lang="ts">
import { reactive, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import Modal from "@/components/ui/modal.vue";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";
import { api } from "@/lib/api";
import { useNotificationStore } from "@/stores/notifications";

const open = defineModel<boolean>("open", { required: true });
const form = reactive({
  name: "",
  prefix: "",
  baseUrl: "https://api.openai.com/v1",
});
const saving = ref(false);
const queryClient = useQueryClient();
const notices = useNotificationStore();

async function submit() {
  if (
    !form.name.trim() ||
    !form.prefix.trim() ||
    !form.baseUrl.trim() ||
    saving.value
  )
    return;
  saving.value = true;
  try {
    await api.nodes.create({
      type: "custom-embedding",
      name: form.name.trim(),
      prefix: form.prefix.trim(),
      baseUrl: form.baseUrl.trim(),
    });
    await queryClient.invalidateQueries({
      queryKey: ["provider-catalog", "media", "embedding"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["provider-nodes", "media", "embedding"],
    });
    open.value = false;
    notices.push("success", "Custom embedding provider created.");
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error
        ? error.message
        : "Could not create custom embedding provider.",
    );
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :open="open" title="Add Custom Embedding" @close="open = false"
    ><form class="space-y-4" @submit.prevent="submit">
      <div class="space-y-2">
        <Label for="embedding-name">Name</Label
        ><Input
          id="embedding-name"
          v-model="form.name"
          placeholder="Voyage AI"
          required
        />
      </div>
      <div class="space-y-2">
        <Label for="embedding-prefix">Prefix</Label
        ><Input
          id="embedding-prefix"
          v-model="form.prefix"
          placeholder="voyage"
          required
        />
        <p class="text-xs text-muted-foreground">
          Use this prefix in model IDs.
        </p>
      </div>
      <div class="space-y-2">
        <Label for="embedding-base-url">Base URL</Label
        ><Input
          id="embedding-base-url"
          v-model="form.baseUrl"
          type="url"
          placeholder="https://api.voyageai.com/v1"
          required
        />
      </div>
      <div class="flex gap-2">
        <Button type="submit" :disabled="saving">{{
          saving ? "Creating..." : "Create"
        }}</Button
        ><Button type="button" variant="ghost" @click="open = false"
          >Cancel</Button
        >
      </div>
    </form></Modal
  >
</template>
