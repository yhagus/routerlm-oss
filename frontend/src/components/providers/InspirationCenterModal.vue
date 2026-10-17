<script setup lang="ts">
import Modal from "@/components/ui/modal.vue";
import Button from "@/components/ui/button.vue";
import Select from "@/components/ui/select.vue";

export interface InspirationItem {
  inspiration_id: string;
  title: string;
  reward_points: number;
  completed: boolean;
  done: boolean;
}

const INSPIRATION_LANGUAGES = [
  "en",
  "zh-CN",
  "ja",
  "ko",
  "es",
  "ru",
  "pt-BR",
  "id",
  "hi",
  "ar",
  "tr",
] as const;

const languageOptions = INSPIRATION_LANGUAGES.map((language) => ({
  value: language,
  label: language,
}));

const props = defineProps<{
  open: boolean;
  connectionLabel: string;
  items: InspirationItem[];
  loading: boolean;
  claiming: Record<string, boolean>;
  claimingAll: boolean;
  error: string | null;
  language: string;
}>();
const emit = defineEmits<{
  close: [];
  claim: [inspirationId: string];
  claimAll: [];
  claimAllLanguages: [];
  "update:language": [language: string];
}>();
</script>

<template>
  <Modal :open="props.open" title="Inspiration Center" size="lg" @close="emit('close')">
    <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-xs text-muted-foreground">
        Prompt cards for {{ props.connectionLabel }}. Each claimed card mints
        its reward once. Cards already completed upstream sync as done on open.
      </p>
      <Select
        :model-value="props.language"
        :options="languageOptions"
        class="h-8 w-auto min-w-24 text-xs"
        aria-label="Card language"
        @update:model-value="(value) => emit('update:language', String(value || 'id'))"
      />
    </div>
    <div v-if="props.loading" class="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      Loading cards…
    </div>
    <p v-else-if="props.error" class="py-6 text-sm text-red-500">{{ props.error }}</p>
    <div v-else class="space-y-2">
      <div
        v-for="item in props.items"
        :key="item.inspiration_id"
        class="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium" :title="item.title">{{ item.title }}</p>
          <p class="text-xs text-muted-foreground">+{{ item.reward_points }} pts</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          :disabled="item.done || props.claiming[item.inspiration_id] === true"
          @click="emit('claim', item.inspiration_id)"
        >
          {{
            props.claiming[item.inspiration_id] === true
              ? "Claiming…"
              : item.done
                ? "Done"
                : "Claim"
          }}
        </Button>
      </div>
      <p v-if="!props.items.length" class="py-4 text-center text-xs text-muted-foreground">
        No cards available.
      </p>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <Button size="sm" variant="secondary" @click="emit('close')">Close</Button>
      <Button
        size="sm"
        variant="secondary"
        :disabled="props.loading || props.claimingAll"
        title="Claim pending cards in all languages for this account"
        @click="emit('claimAllLanguages')"
      >
        {{ props.claimingAll ? "Claiming…" : "Claim all languages" }}
      </Button>
      <Button
        size="sm"
        :disabled="props.loading || props.claimingAll || props.items.every((item) => item.done)"
        @click="emit('claimAll')"
      >
        {{ props.claimingAll ? "Claiming…" : "Claim all" }}
      </Button>
    </div>
  </Modal>
</template>
