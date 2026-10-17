<script setup lang="ts">
import { ref, watch } from "vue";
import Modal from "@/components/ui/modal.vue";
import CurlPlayground from "@/components/playground/CurlPlayground.vue";
import { buildChatCurl } from "@/lib/curl";

const props = defineProps<{
  open: boolean;
  model: string;
  baseUrl: string;
  apiKey: string;
}>();
const emit = defineEmits<{ close: [] }>();

const curl = ref("");
const playground = ref<InstanceType<typeof CurlPlayground> | null>(null);

watch(
  () => [props.open, props.model] as const,
  ([open]) => {
    if (open)
      curl.value = buildChatCurl(props.baseUrl, props.apiKey, props.model);
  },
  { immediate: true },
);
</script>

<template>
  <Modal
    :open="open"
    :title="`Try ${model}`"
    size="full"
    @close="emit('close')"
  >
    <CurlPlayground
      ref="playground"
      v-model="curl"
      response-class="max-h-[40vh]"
    />
  </Modal>
</template>
