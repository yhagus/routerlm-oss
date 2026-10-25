<script setup lang="ts">
import { ref } from "vue";
import { ImagePlus, Trash2 } from "lucide-vue-next";
import { LOGO_ACCEPT, readLogoFile } from "@/lib/logoImage";
import ProviderLogo from "@/components/app/ProviderLogo.vue";
import Button from "@/components/ui/button.vue";

const props = defineProps<{ id: string; label?: string }>();
const logo = defineModel<string | null>({ default: null });
const fileInput = ref<HTMLInputElement | null>(null);
const error = ref("");

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = "";
  try {
    logo.value = await readLogoFile(file);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "Unable to use this image";
  }
}

function removeLogo() {
  logo.value = null;
  error.value = "";
}
</script>

<template>
  <div class="flex items-center gap-3">
    <ProviderLogo :src="logo || undefined" :label="props.label" size="size-12" />
    <div class="min-w-0 space-y-1.5">
      <div class="flex flex-wrap gap-2">
        <Button
          :id="props.id"
          size="sm"
          variant="outline"
          @click="fileInput?.click()"
          ><ImagePlus class="size-4" />{{ logo ? "Change logo" : "Upload logo" }}</Button
        ><Button v-if="logo" size="sm" variant="ghost" @click="removeLogo"
          ><Trash2 class="size-4" />Remove</Button
        >
      </div>
      <p
        class="text-xs"
        :class="error ? 'text-destructive' : 'text-muted-foreground'"
        :role="error ? 'alert' : undefined"
      >
        {{ error || "Optional. PNG, JPEG, WebP, GIF or SVG." }}
      </p>
    </div>
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :accept="LOGO_ACCEPT"
      @change="onFileChange"
    />
  </div>
</template>
