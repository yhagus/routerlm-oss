<script setup lang="ts">
import { Check, Copy } from "lucide-vue-next";
import { ref } from "vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import { useNotificationStore } from "@/stores/notifications";

const props = defineProps<{
  language: string;
  value: string;
  filename?: string;
}>();
const notices = useNotificationStore();
const copied = ref(false);

async function copyConfiguration() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    notices.push("success", "Configuration copied to the clipboard.");
    window.setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {
    notices.push("error", "Could not copy the configuration.");
  }
}
</script>

<template>
  <Card class="overflow-hidden">
    <div class="flex items-center justify-between gap-3 border-b px-4 py-3">
      <div class="min-w-0">
        <p
          class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
        >
          {{ props.language }}
        </p>
        <p
          v-if="props.filename"
          class="mt-1 truncate font-mono text-xs text-muted-foreground"
        >
          {{ props.filename }}
        </p>
      </div>
      <Button variant="outline" @click="copyConfiguration"
        ><Check v-if="copied" class="size-3.5 text-success" /><Copy
          v-else
          class="size-3.5"
        />{{ copied ? "Copied" : "Copy" }}</Button
      >
    </div>
    <pre
      class="max-h-[28rem] overflow-auto bg-muted/35 p-4 text-xs leading-6 text-foreground"
    ><code>{{ props.value }}</code></pre>
  </Card>
</template>
