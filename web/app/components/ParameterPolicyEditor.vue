<script setup lang="ts">
import {
  formFromPolicy,
  isCappable,
  type ParameterPolicy,
  POLICY_PARAMETERS,
  policyFromForm,
  REASONING_EFFORTS,
  RULE_KINDS,
} from "~/lib/parameterPolicy";

// The Parameter Policy form, for a Model or a Route override. It checks the
// policy before emitting `save`; the backend checks it again.
const props = defineProps<{
  policy: ParameterPolicy | null;
  isSaving: boolean;
  submitLabel: string;
  /** The backend's message when the last save failed. */
  error: string;
}>();
const emit = defineEmits<{ save: [policy: ParameterPolicy] }>();

const form = ref(formFromPolicy(props.policy));
const problem = ref("");
watch(
  () => props.policy,
  (policy) => {
    form.value = formFromPolicy(policy);
    problem.value = "";
  },
);

const effortOptions = [
  { label: "Not set", value: "" },
  ...REASONING_EFFORTS.map((effort) => ({ label: effort, value: effort })),
];

function submit(): void {
  const result = policyFromForm(form.value);
  if ("problem" in result) {
    problem.value = result.problem;
    return;
  }
  problem.value = "";
  emit("save", result.policy);
}
</script>

<template>
  <form class="form policy-form" @submit.prevent="submit">
    <div class="table-wrap">
      <table class="policy-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th v-for="{ kind, label } in RULE_KINDS" :key="kind">{{ label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="parameter in POLICY_PARAMETERS" :key="parameter.name">
            <td>
              {{ parameter.label }}
              <span class="cell-note">{{ parameter.hint }}</span>
            </td>
            <td v-for="{ kind, label } in RULE_KINDS" :key="kind">
              <span v-if="kind === 'caps' && !isCappable(parameter.name)" class="cell-note">—</span>
              <AppSelect
                v-else-if="parameter.name === 'reasoningEffort'"
                v-model="form.rules[kind].reasoningEffort"
                :options="effortOptions"
                :aria-label="`${label} ${parameter.label}`"
              />
              <textarea
                v-else-if="parameter.name === 'stopSequences'"
                v-model="form.rules[kind].stopSequences"
                class="text-input text-area"
                rows="2"
                :aria-label="`${label} ${parameter.label}`"
              />
              <input
                v-else
                v-model="form.rules[kind][parameter.name]"
                class="text-input"
                inputmode="decimal"
                autocomplete="off"
                :aria-label="`${label} ${parameter.label}`"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <label class="field policy-form__prompt"
      ><span class="field__label">System prompt</span
      ><textarea
        v-model="form.systemPrompt"
        class="text-input text-area"
        rows="4"
        placeholder="Optional. Sent as written, before the client's own system content."
      />
      <span class="form__hint"
        >Plain text with no variables, so every request starts with the same bytes and upstream
        prompt caches keep working.</span
      ></label
    >
    <p v-if="problem || error" class="form__error policy-form__error" role="alert">
      {{ problem || error }}
    </p>
    <div class="dialog__actions policy-form__actions">
      <slot name="actions" />
      <button class="button button--primary" type="submit" :disabled="isSaving">
        {{ submitLabel }}
      </button>
    </div>
  </form>
</template>
