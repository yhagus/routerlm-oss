<script setup lang="ts">
import { ref } from "vue";
import Card from "@/components/ui/card.vue";
import Badge from "@/components/ui/badge.vue";
import { SKILLS, skillRawUrl } from "@/lib/skills";

const copied = ref("");

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    copied.value = value;
    window.setTimeout(() => {
      if (copied.value === value) copied.value = "";
    }, 2000);
  } catch {
    // Clipboard access is optional.
  }
}
</script>

<template>
  <div class="theme-v2 mx-auto max-w-4xl space-y-6">
    <Card class="p-5"
      ><p class="mb-2 text-xs text-muted-foreground">Paste this to your AI:</p>
      <code class="block rounded bg-muted px-3 py-2 text-[12px]"
        >Read this skill and use it: {{ skillRawUrl("lobakai") }}</code
      ></Card
    >
    <div class="space-y-2">
      <div
        v-for="skill in SKILLS"
        :key="skill.id"
        class="flex items-start gap-3 rounded-[14px] border p-4 shadow-sm"
        :class="
          skill.isEntry
            ? 'border-primary/40 bg-primary/5'
            : 'bg-card hover:bg-muted/50'
        "
      >
        <div
          class="grid size-9 shrink-0 place-items-center rounded-lg"
          :class="
            skill.isEntry
              ? 'bg-primary text-primary-foreground'
              : 'bg-primary/10 text-primary'
          "
        >
          <span class="material-symbols-outlined text-[18px]">{{
            skill.icon
          }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-semibold">{{ skill.name }}</h3>
            <Badge v-if="skill.isEntry" variant="default">START HERE</Badge
            ><Badge v-if="skill.endpoint" variant="secondary"
              ><code class="text-[10px]">{{ skill.endpoint }}</code></Badge
            >
          </div>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ skill.description }}
          </p>
          <a
            :href="skillRawUrl(skill.id)"
            target="_blank"
            rel="noreferrer"
            class="mt-1 inline-flex break-all text-[11px] text-muted-foreground hover:text-primary"
            >{{ skillRawUrl(skill.id)
            }}<span class="material-symbols-outlined text-[12px]"
              >open_in_new</span
            ></a
          >
        </div>
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
          :title="skillRawUrl(skill.id)"
          @click="copy(skillRawUrl(skill.id))"
        >
          <span class="material-symbols-outlined text-[12px]">{{
            copied === skillRawUrl(skill.id) ? "check" : "content_copy"
          }}</span
          >{{ copied === skillRawUrl(skill.id) ? "Copied!" : "Copy link" }}
        </button>
      </div>
    </div>
  </div>
</template>
