<script setup lang="ts">
import { ref } from "vue";
import { Check, Languages, X } from "lucide-vue-next";
import {
  LOCALES,
  localeFromCookie,
  localeInfo,
  type Locale,
} from "@/lib/locales";
import { reloadTranslations } from "@/lib/i18n";
import { useNotificationStore } from "@/stores/notifications";
import Button from "@/components/ui/button.vue";

const notifications = useNotificationStore();
const open = ref(false);
const pending = ref(false);
const locale = ref<Locale>(localeFromCookie());

async function choose(next: Locale) {
  if (next === locale.value || pending.value) return;
  pending.value = true;
  try {
    const response = await fetch("/api/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ locale: next }),
    });
    if (!response.ok) throw new Error("Locale update failed");
    locale.value = next;
    await reloadTranslations();
    open.value = false;
  } catch (error) {
    notifications.push(
      "error",
      error instanceof Error ? error.message : "Locale update failed",
    );
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    :aria-label="`Language: ${localeInfo(locale)[1]}`"
    title="Language"
    data-i18n-skip="true"
    @click="open = true"
    ><span class="text-base leading-none">{{
      localeInfo(locale)[2]
    }}</span></Button
  >
  <div
    v-if="open"
    class="fixed inset-0 z-[70] grid place-items-center p-4"
    data-i18n-skip="true"
  >
    <button
      class="absolute inset-0 bg-black/40 backdrop-blur-sm"
      aria-label="Close language selector"
      @click="open = false"
    />
    <section
      class="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Select language"
    >
      <header
        class="flex items-center justify-between border-b border-border px-4 py-3"
      >
        <h2 class="text-lg font-semibold">Select Language</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close language selector"
          @click="open = false"
          ><X class="size-4"
        /></Button>
      </header>
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 overflow-y-auto p-5"
      >
        <button
          v-for="item in LOCALES"
          :key="item[0]"
          :disabled="pending"
          :class="[
            'flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg px-2 py-3 text-xs font-medium',
            item[0] === locale
              ? 'bg-primary/15 text-primary ring-2 ring-primary'
              : 'hover:bg-secondary',
            pending && 'cursor-wait opacity-70',
          ]"
          :title="item[1]"
          @click="choose(item[0])"
        >
          <span class="text-2xl">{{ item[2] }}</span
          ><span class="line-clamp-2 text-center leading-tight">{{
            item[1]
          }}</span
          ><Check v-if="item[0] === locale" class="size-3.5" />
        </button>
      </div>
    </section>
  </div>
</template>
