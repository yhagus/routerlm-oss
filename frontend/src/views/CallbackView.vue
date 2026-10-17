<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { Check, Clipboard, Info, LoaderCircle } from "lucide-vue-next";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import ThemeToggle from "@/components/app/ThemeToggle.vue";

const route = useRoute();
const state = ref<"processing" | "success" | "manual">("processing");
const currentUrl = ref("");

onMounted(() => {
  currentUrl.value = window.location.href;
  const query = route.query;
  const payload = {
    code: query.code || null,
    token: query.token || null,
    state: query.state || null,
    error: query.error || null,
    errorDescription: query.error_description || null,
    fullUrl: window.location.href,
  };
  const hasResult = Boolean(payload.code || payload.token || payload.error);
  const origins = [window.location.origin, "http://localhost:1455"];
  if (window.opener)
    for (const origin of origins) {
      try {
        window.opener.postMessage(
          { type: "oauth_callback", data: payload },
          origin,
        );
      } catch {
        /* closed or cross-origin opener */
      }
    }
  try {
    const channel = new BroadcastChannel("oauth_callback");
    channel.postMessage(payload);
    channel.close();
  } catch {
    /* unsupported browser */
  }
  try {
    localStorage.setItem(
      "oauth_callback",
      JSON.stringify({ ...payload, timestamp: Date.now() }),
    );
  } catch {
    /* storage disabled */
  }
  state.value = hasResult ? "success" : "manual";
  if (hasResult) window.setTimeout(() => window.close(), 1500);
});

async function copy() {
  await navigator.clipboard?.writeText(currentUrl.value);
}
</script>

<template>
  <main class="relative grid min-h-screen place-items-center bg-background p-4">
    <div class="absolute right-4 top-4 z-10"><ThemeToggle /></div>

    <Card class="w-full max-w-md p-7 text-center"
      ><LoaderCircle
        v-if="state === 'processing'"
        class="mx-auto size-12 animate-spin text-primary"
      /><Check
        v-else-if="state === 'success'"
        class="mx-auto size-12 text-success"
      /><Info v-else class="mx-auto size-12 text-warning" />
      <h1 class="mt-5 text-xl font-semibold">
        {{
          state === "processing"
            ? "Processing authorization"
            : state === "success"
              ? "Authorization successful"
              : "Copy this URL"
        }}
      </h1>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        {{
          state === "success"
            ? "This window will close automatically."
            : state === "manual"
              ? "Paste the callback URL into the application that started sign-in."
              : "Please wait while the authorization result is relayed."
        }}
      </p>
      <div v-if="state === 'manual'" class="mt-5 space-y-3">
        <code
          class="block break-all rounded-lg bg-muted p-3 text-left text-xs"
          >{{ currentUrl }}</code
        ><Button variant="outline" @click="copy"
          ><Clipboard class="size-4" />Copy URL</Button
        >
      </div></Card
    >
  </main>
</template>
