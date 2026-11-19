<script setup lang="ts">
/** The transcription tab's request parameters, in the side rail and the narrow-screen sheet alike. */
const language = defineModel<string>("language", { required: true });
</script>

<template>
  <div class="form playground-settings">
    <div class="playground-settings__grid">
      <label class="field">
        <span class="field__label">Language (optional)</span>
        <input
          v-model="language"
          class="text-input"
          type="text"
          placeholder="An ISO-639-1 code, e.g. en"
        />
      </label>
    </div>
  </div>
</template>
