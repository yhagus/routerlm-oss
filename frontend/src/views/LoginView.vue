<script setup lang="ts">
import { ref } from "vue";
import LobakLogo from "@/components/app/LobakLogo.vue";
import { useRoute, useRouter } from "vue-router";
import { LockKeyhole, Eye, EyeOff, LoaderCircle } from "lucide-vue-next";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Card from "@/components/ui/card.vue";
import LanguageSwitcher from "@/components/app/LanguageSwitcher.vue";
import { useSessionStore } from "@/stores/session";
import { useNotificationStore } from "@/stores/notifications";
import { ApiError } from "@/lib/api";
import ThemeToggle from "@/components/app/ThemeToggle.vue";

const password = ref("");
const error = ref("");
const showPassword = ref(false);
const session = useSessionStore();
const notices = useNotificationStore();
const router = useRouter();
const route = useRoute();

async function submit() {
  error.value = "";
  try {
    await session.login(password.value);
    notices.push("success", "Your operator session is ready.", "Signed in");
    await router.push(String(route.query.redirect || "/dashboard"));
  } catch (reason) {
    error.value =
      reason instanceof ApiError
        ? reason.message
        : "Unable to sign in right now.";
  }
}
</script>

<template>
  <main
    class="theme-v2 relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-10"
  >
    <div
      class="page-grid pointer-events-none absolute inset-0 opacity-60"
      aria-hidden="true"
    />

    <div class="absolute right-4 top-4 flex items-center gap-1.5">
      <ThemeToggle />
      <LanguageSwitcher />
    </div>

    <Card
      class="relative w-full max-w-sm p-8 shadow-[0_24px_80px_-35px_rgb(0_0_0/0.3)]"
    >
      <!-- Brand -->
      <div class="mb-8 text-center">
        <LobakLogo class="mx-auto size-12" />
        <h1 class="mt-5 text-2xl font-semibold tracking-tight">
          Sign in to continue
        </h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Use the dashboard password configured for this gateway.
        </p>
      </div>

      <!-- Form -->
      <form class="space-y-6" @submit.prevent="submit">
        <div>
          <div class="relative">
            <LockKeyhole
              class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="password"
              v-model="password"
              class="px-10"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="Enter password"
              aria-label="Dashboard password"
              autofocus
              :aria-invalid="!!error"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              <Eye v-if="!showPassword" class="size-4" />
              <EyeOff v-else class="size-4" />
            </button>
          </div>
        </div>

        <p
          v-if="error"
          class="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {{ error }}
        </p>

        <Button
          class="w-full"
          type="submit"
          :disabled="session.loading || !password"
        >
          <LoaderCircle v-if="session.loading" class="size-4 animate-spin" />
          {{ session.loading ? "Signing in…" : "Open console" }}
        </Button>
      </form>

      <p class="mt-8 text-center text-xs text-muted-foreground">
        LobakAI · local proxy console
      </p>
    </Card>
  </main>
</template>
