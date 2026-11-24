<script setup lang="ts">
defineProps<{ reasoningOptions: { value: string; label: string }[] }>();

const systemPrompt = defineModel<string>("systemPrompt", { required: true });
const temperature = defineModel<string>("temperature", { required: true });
const topP = defineModel<string>("topP", { required: true });
const maxOutputTokens = defineModel<string>("maxOutputTokens", { required: true });
const reasoningEffort = defineModel<string>("reasoningEffort", { required: true });
</script>

<template>
  <div class="form playground-settings">
    <label class="field">
      <span class="field__label">System prompt</span>
      <textarea
        v-model="systemPrompt"
        class="text-input text-area"
        rows="4"
        placeholder="Optional. Sent before the conversation."
      />
    </label>
    <div class="playground-settings__grid">
      <label class="field">
        <span class="field__label">Temperature</span>
        <NumberInput
          v-model="temperature"
          class="text-input"
          :min="0"
          :max="2"
          placeholder="0 to 2"
        />
      </label>
      <label class="field">
        <span class="field__label">Top P</span>
        <NumberInput v-model="topP" class="text-input" :min="0" :max="1" placeholder="0 to 1" />
      </label>
      <label class="field">
        <span class="field__label">Max output tokens</span>
        <NumberInput
          v-model="maxOutputTokens"
          class="text-input"
          whole
          tokens
          :min="1"
          placeholder="e.g. 4k"
        />
      </label>
      <div class="field">
        <span class="field__label">Reasoning effort</span>
        <AppSelect v-model="reasoningEffort" :options="reasoningOptions" label="Reasoning effort" />
      </div>
    </div>
  </div>
</template>
