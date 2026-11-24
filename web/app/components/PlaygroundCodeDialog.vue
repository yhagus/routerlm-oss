<script setup lang="ts">
import { computed, ref } from "vue";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
} from "@/components/ai-elements/code-block";

const props = defineProps<{
  request: { body: Record<string, unknown> } | { problem: string };
}>();
const isOpen = defineModel<boolean>("open", { required: true });

const FORMATS = [
  { value: "curl", label: "curl" },
  { value: "typescript", label: "TypeScript" },
] as const;
type Format = (typeof FORMATS)[number]["value"];
const format = ref<Format>("curl");
const language = computed(() => (format.value === "curl" ? "bash" : "typescript"));

function withoutImageData(value: unknown): unknown {
  if (typeof value === "string" && /^(data|blob):/.test(value)) return "<image data URL>";
  if (Array.isArray(value)) return value.map(withoutImageData);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, withoutImageData(entry)]),
    );
  }
  return value;
}

function indented(text: string, spaces: number): string {
  return text.replaceAll("\n", `\n${" ".repeat(spaces)}`);
}

const code = computed(() => {
  if ("problem" in props.request) return "";
  const json = JSON.stringify(withoutImageData(props.request.body), null, 2);
  if (format.value === "curl") {
    return [
      'curl "$ROUTERLM_BASE_URL/v1/chat/completions" \\',
      '  -H "Authorization: Bearer $ROUTERLM_API_KEY" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '${indented(json.replaceAll("'", "'\\''"), 2)}'`,
    ].join("\n");
  }
  return [
    'import OpenAI from "openai";',
    "",
    "const client = new OpenAI({",
    "  baseURL: `${process.env.ROUTERLM_BASE_URL}/v1`,",
    "  apiKey: process.env.ROUTERLM_API_KEY,",
    "});",
    "",
    `const stream = await client.chat.completions.create(${json});`,
    "",
    "for await (const chunk of stream) {",
    '  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");',
    "}",
  ].join("\n");
});
</script>

<template>
  <AppDialog
    v-model:open="isOpen"
    title="Request as code"
    description="The same request through the gateway, as a client application sends it. Set ROUTERLM_BASE_URL to your gateway's address and ROUTERLM_API_KEY to an API Key."
    wide
  >
    <p v-if="'problem' in request" class="form__error" role="alert">{{ request.problem }}</p>
    <template v-else>
      <CodeBlock
        class="tw-scope rounded-xl border-[var(--line-soft)] [&_code]:text-xs [&_pre]:max-h-[50dvh] [&_pre]:text-xs [&_pre]:leading-relaxed"
        :code="code"
        :language="language"
      >
        <CodeBlockHeader
          class="border-b border-[var(--line-soft)] bg-[var(--panel-2)] py-1.5 pr-1.5 pl-2"
        >
          <div class="segmented" role="group" aria-label="Format">
            <button
              v-for="option in FORMATS"
              :key="option.value"
              class="segmented__option"
              type="button"
              :aria-pressed="format === option.value"
              @click="format = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <CodeBlockActions>
            <CodeBlockCopyButton aria-label="Copy code" />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
      <p class="form__hint">
        Includes the conversation so far and the unsent message. Images are shown as a placeholder.
      </p>
    </template>
    <div class="dialog__actions">
      <button class="button" type="button" @click="isOpen = false">Close</button>
    </div>
  </AppDialog>
</template>
