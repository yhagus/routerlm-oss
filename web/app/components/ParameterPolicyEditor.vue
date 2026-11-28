<script setup lang="ts">
import {
  budgetsWithoutEffort,
  capsWithoutDefault,
  formFromPolicy,
  isRuleOffered,
  numberRange,
  type ParameterPolicy,
  POLICY_PARAMETERS,
  policyFromForm,
  REASONING_EFFORTS,
  RULE_KINDS,
  SERVICE_TIER_LABELS,
  SERVICE_TIERS,
} from '~/lib/parameterPolicy';

const props = defineProps<{
  policy: ParameterPolicy | null;
  isSaving: boolean;
  submitLabel: string;
  error: string;
}>();
const emit = defineEmits<{ save: [policy: ParameterPolicy] }>();

const form = ref(formFromPolicy(props.policy));
const problem = ref('');
watch(
  () => props.policy,
  (policy) => {
    form.value = formFromPolicy(policy);
    problem.value = '';
  },
);

const uncoveredCaps = computed(() => capsWithoutDefault(form.value));
const effortlessBudgets = computed(() => budgetsWithoutEffort(form.value));

const effortOptions = [
  { label: 'Not set', value: '' },
  ...REASONING_EFFORTS.map((effort) => ({ label: effort, value: effort })),
];
const serviceTierOptions = [
  { label: 'None', value: '' },
  ...SERVICE_TIERS.map((tier) => ({ label: SERVICE_TIER_LABELS[tier], value: tier })),
];
const watermarkOptions = [
  { label: 'Not set', value: '' },
  { label: 'On', value: 'true' },
  { label: 'Off', value: 'false' },
];

function submit(): void {
  const result = policyFromForm(form.value);
  if ('problem' in result) {
    problem.value = result.problem;
    return;
  }
  problem.value = '';
  emit('save', result.policy);
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
              <span v-if="!isRuleOffered(parameter.name, kind)" class="cell-note">—</span>
              <AppSelect
                v-else-if="parameter.name === 'reasoningEffort'"
                v-model="form.rules[kind].reasoningEffort"
                :options="effortOptions"
                :label="`${label} ${parameter.label}`"
              />
              <AppSelect
                v-else-if="parameter.name === 'serviceTier'"
                v-model="form.rules[kind].serviceTier"
                :options="serviceTierOptions"
                :label="`${label} ${parameter.label}`"
              />
              <AppSelect
                v-else-if="parameter.name === 'watermark'"
                v-model="form.rules[kind].watermark"
                :options="watermarkOptions"
                :label="`${label} ${parameter.label}`"
              />
              <input
                v-else-if="parameter.name === 'voice'"
                v-model="form.rules[kind].voice"
                class="text-input"
                type="text"
                :aria-label="`${label} ${parameter.label}`"
              />
              <textarea
                v-else-if="parameter.name === 'stopSequences'"
                v-model="form.rules[kind].stopSequences"
                class="text-input text-area"
                rows="2"
                :aria-label="`${label} ${parameter.label}`"
              />
              <NumberInput
                v-else
                v-model="form.rules[kind][parameter.name]"
                class="text-input"
                :whole="numberRange(parameter.name)?.isWhole"
                :tokens="
                  parameter.name === 'maxOutputTokens' || parameter.name === 'reasoningBudgetTokens'
                "
                :min="numberRange(parameter.name)?.min"
                :max="
                  parameter.name === 'maxOutputTokens' || parameter.name === 'reasoningBudgetTokens'
                    ? undefined
                    : numberRange(parameter.name)?.max
                "
                :aria-label="`${label} ${parameter.label}`"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="uncoveredCaps.length > 0" class="form__hint" role="status">
      A Cap only lowers a value that is sent. With no default beside it, an omitted parameter stays
      omitted: {{ uncoveredCaps.join(', ') }}.
    </p>
    <p v-if="effortlessBudgets.length > 0" class="form__hint" role="status">
      openai-chat and openai-responses Routes ignore a thinking budget. Set a reasoning effort
      beside it for reasoning there: {{ effortlessBudgets.join(', ') }}.
    </p>
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
