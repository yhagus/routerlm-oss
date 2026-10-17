<script setup lang="ts">
// Port of v1 BulkImport{Codex,Qoder,GrokCli}Modal — provider bulk-add via
// the v2 oauth special endpoints (same payloads as the v1 /api/oauth/*/bulk-import).
import { computed, ref, watch } from "vue";
import { api } from "@/lib/api";
import Modal from "@/components/ui/modal.vue";
import Button from "@/components/ui/button.vue";

type BulkProvider = "codex" | "qoder" | "grok-cli" | "codebuddy-intl-cli";

const CONFIG: Record<
  BulkProvider,
  { title: string; placeholder: string; multiline: boolean }
> = {
  codex: {
    title: "Bulk Add Codex Accounts",
    placeholder: '[\n  { "accessToken": "...", "refreshToken": "..." }\n]',
    multiline: true,
  },
  qoder: {
    title: "Bulk Add Qoder Accounts",
    placeholder: "pt-abc123...\npt-def456...\npt-ghi789...",
    multiline: false,
  },
  "grok-cli": {
    title: "Bulk Add Grok CLI Accounts",
    placeholder: "oauth_refresh_token_1...\noauth_refresh_token_2...",
    multiline: false,
  },
  "codebuddy-intl-cli": {
    title: "Bulk Add CodeBuddy CLI Accounts",
    placeholder: "refresh_token_1...\nrefresh_token_2...",
    multiline: false,
  },
};

const props = defineProps<{ open: boolean; provider: BulkProvider }>();
const emit = defineEmits<{ close: []; success: [] }>();

const config = computed(() => CONFIG[props.provider]);
const inputText = ref("");
const submitting = ref(false);
const parseError = ref("");
const result = ref<{
  success?: number;
  failed?: number;
  imported?: number;
} | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) {
      inputText.value = "";
      parseError.value = "";
      result.value = null;
    }
  },
);

function handleClose() {
  if (submitting.value) return;
  emit("close");
}

async function handleSubmit() {
  parseError.value = "";
  result.value = null;
  const text = inputText.value.trim();
  if (!text || submitting.value) return;

  let body: Record<string, unknown> | unknown[];
  if (props.provider === "codex") {
    let accounts: unknown;
    try {
      accounts = JSON.parse(text);
    } catch {
      parseError.value = "Input must be valid JSON.";
      return;
    }
    const list = Array.isArray(accounts)
      ? accounts
      : (accounts as Record<string, unknown>)?.accounts;
    if (!Array.isArray(list)) {
      parseError.value = "No accounts found in the import data.";
      return;
    }
    body = { accounts: list };
  } else if (props.provider === "qoder") {
    const accounts = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((pat) => ({ pat }));
    if (!accounts.length) return;
    body = { accounts };
  } else {
    const accounts = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((refreshToken) => ({ refreshToken }));
    if (!accounts.length) return;
    body = { accounts };
  }

  submitting.value = true;
  try {
    const response = await api.oauth.special(
      `${props.provider}/bulk-import`,
      body,
    );
    result.value = response;
    if (((response.success ?? response.imported ?? 0) as number) > 0)
      emit("success");
  } catch (error) {
    parseError.value =
      error instanceof Error ? error.message : "Request failed";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Modal :open="open" :title="config.title" @close="handleClose">
    <div class="flex flex-col gap-3">
      <p class="text-xs text-muted-foreground">
        {{
          provider === "codex"
            ? "Paste an array of Codex accounts (accessToken + refreshToken)."
            : provider === "qoder"
              ? "One Qoder personal access token per line."
              : provider === "codebuddy-intl-cli"
                ? "One CodeBuddy CLI refresh token per line."
                : "One Grok CLI OAuth refresh token per line."
        }}
      </p>
      <textarea
        v-model="inputText"
        class="min-h-[140px] w-full resize-y rounded border border-accent/30 bg-sidebar p-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        :placeholder="config.placeholder"
        spellcheck="false"
      />
      <p v-if="parseError" class="break-words text-xs text-red-500">
        {{ parseError }}
      </p>
      <p v-if="result" class="text-sm text-green-500">
        ✓ {{ result.success ?? result.imported ?? 0 }} imported<template
          v-if="result.failed"
          >, ✗ {{ result.failed }} failed</template
        >
      </p>
      <div class="flex gap-2">
        <Button
          class="flex-1"
          :disabled="submitting || !inputText.trim()"
          @click="handleSubmit"
          >{{ submitting ? "Importing..." : "Import" }}</Button
        >
        <Button
          class="flex-1"
          variant="ghost"
          :disabled="submitting"
          @click="handleClose"
          >Cancel</Button
        >
      </div>
    </div>
  </Modal>
</template>
