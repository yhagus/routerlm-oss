<script setup lang="ts">
import { ref } from "vue";
import { MIN_PASSWORD_LENGTH } from "~/lib/users";

export interface Credentials {
  email: string;
  password: string;
}

const props = defineProps<{
  submitLabel: string;
  passwordAutocomplete: "current-password" | "new-password";
  isSubmitting: boolean;
  errorMessage: string;
}>();
const emit = defineEmits<{ submit: [credentials: Credentials] }>();

const email = ref("");
const password = ref("");
const minPasswordLength =
  props.passwordAutocomplete === "new-password" ? MIN_PASSWORD_LENGTH : undefined;
</script>

<template>
  <form class="form" @submit.prevent="emit('submit', { email, password })">
    <label class="field"
      ><span class="field__label">Email</span
      ><input v-model="email" class="text-input" type="email" autocomplete="email" required
    /></label>
    <label class="field"
      ><span class="field__label">Password</span
      ><input
        v-model="password"
        class="text-input"
        type="password"
        :autocomplete="passwordAutocomplete"
        :minlength="minPasswordLength"
        required
    /></label>
    <p v-if="errorMessage" class="form__error" role="alert">{{ errorMessage }}</p>
    <button class="button button--primary form__submit" type="submit" :disabled="isSubmitting">
      {{ submitLabel }}
    </button>
  </form>
</template>
