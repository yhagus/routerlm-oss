<script setup lang="ts">
import { ref } from "vue";
import type { Credentials } from "~/components/CredentialsForm.vue";
import { apiErrorMessage } from "~/lib/api";
import type { User } from "~/lib/users";

definePageMeta({ layout: "auth" });
useHead({ title: "Set up RouterLM" });

const currentUser = useCurrentUser();
const { $dashboardApi } = useNuxtApp();
const isSubmitting = ref(false);
const errorMessage = ref("");

async function createFirstUser(credentials: Credentials): Promise<void> {
  isSubmitting.value = true;
  errorMessage.value = "";
  try {
    currentUser.value = await $dashboardApi<User>("/auth/setup", {
      method: "POST",
      body: credentials,
    });
    await navigateTo("/");
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, "Couldn't create the User. Try again.");
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="auth-card__heading">
    <h1>Set up RouterLM</h1>
    <p>Create the first User. Every User can manage the whole gateway and add more Users.</p>
  </div>
  <CredentialsForm
    submit-label="Create User and sign in"
    password-autocomplete="new-password"
    :is-submitting="isSubmitting"
    :error-message="errorMessage"
    @submit="createFirstUser"
  />
</template>
