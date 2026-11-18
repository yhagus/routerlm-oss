<script setup lang="ts">
import { ref } from "vue";
import type { Credentials } from "~/components/CredentialsForm.vue";
import { apiErrorMessage } from "~/lib/api";
import type { User } from "~/lib/users";

definePageMeta({ layout: "auth" });
useHead({ title: "Sign in" });

const route = useRoute();
const currentUser = useCurrentUser();
const { $dashboardApi } = useNuxtApp();
const isSubmitting = ref(false);
const errorMessage = ref("");

/** Only a path inside this app, so a crafted link can't send the User elsewhere. */
function redirectTarget(): string {
  const redirect = route.query.redirect;
  // Browsers read a backslash as a slash, so `/\host` would act like `//host`.
  const isLocalPath =
    typeof redirect === "string" &&
    redirect.startsWith("/") &&
    !redirect.startsWith("//") &&
    !redirect.includes("\\");
  return isLocalPath ? redirect : "/";
}

async function signIn(credentials: Credentials): Promise<void> {
  isSubmitting.value = true;
  errorMessage.value = "";
  try {
    currentUser.value = await $dashboardApi<User>("/auth/login", {
      method: "POST",
      body: credentials,
    });
    await navigateTo(redirectTarget());
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, "Couldn't sign in. Try again.");
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="page-view">
    <div class="auth-card__heading">
      <h1>Sign in</h1>
      <p>Use the email and password another User gave you.</p>
    </div>
    <CredentialsForm
      submit-label="Sign in"
      password-autocomplete="current-password"
      :is-submitting="isSubmitting"
      :error-message="errorMessage"
      @submit="signIn"
    />
  </div>
</template>
