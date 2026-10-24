<script setup lang="ts">
// Port of v1 src/shared/components/OAuthModal.js — the full add-connection flow:
// device-code auto-polling, codex fixed-port proxy + poll-status,
// localhost popup with postMessage/BroadcastChannel/localStorage callback
// relay, and manual paste.
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { api } from "@/lib/api";
import Modal from "@/components/ui/modal.vue";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";

const DEVICE_CODE_PROVIDERS = [
  "codebuddy-intl-cli",
  "qoder",
  "grok-cli",
];

const props = defineProps<{
  open: boolean;
  provider: string;
  providerName: string;
  oauthMeta?: Record<string, string> | null;
}>();
const emit = defineEmits<{ close: []; success: [] }>();

const state = reactive({
  step: "waiting" as "waiting" | "input" | "success" | "error",
  authData: null as Record<string, any> | null,
  callbackUrl: "",
  error: "",
  isDeviceCode: false,
  deviceData: null as Record<string, any> | null,
  polling: false,
});
const isLocalhost = ref(false);
const placeholderUrl = ref("/callback?code=...");
let popup: Window | null = null;
let pollingAbort = false;
let pollTimer: number | undefined;
let pollStatusTimer: number | undefined;
let callbackProcessed = false;
let opened = false;
const copiedKey = ref("");
const deviceLoginUrl = computed(() =>
  String(
    state.deviceData?.verification_uri_complete ||
      state.deviceData?.verification_uri ||
      "",
  ),
);
const modalTitle = computed(() => `Connect ${props.providerName}`);

if (typeof window !== "undefined") {
  isLocalhost.value =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  placeholderUrl.value = `${window.location.origin}/callback?code=...`;
}

function openUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copy(value: string, key: string) {
  try {
    await navigator.clipboard?.writeText(value);
    copiedKey.value = key;
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = "";
    }, 1500);
  } catch {
    /* clipboard unavailable */
  }
}

async function exchangeTokensRequest(code: string, stateParam: string | null) {
  if (!state.authData) return;
  try {
    await api.oauth.exchange(props.provider, {
      code,
      redirectUri: state.authData.redirectUri,
      codeVerifier: state.authData.codeVerifier,
      state: stateParam,
      ...(props.oauthMeta ? { meta: props.oauthMeta } : {}),
    });
    state.step = "success";
    emit("success");
  } catch (err) {
    state.error = err instanceof Error ? err.message : "Exchange failed";
    state.step = "error";
  }
}

async function startPolling(
  deviceCode: string,
  codeVerifier: string | undefined,
  interval: number,
  extraData: Record<string, unknown> | null,
  deadlineMs?: number,
) {
  pollingAbort = false;
  state.polling = true;
  let tick = interval;
  const deadline =
    Date.now() +
    (Number.isFinite(deadlineMs as number) && (deadlineMs as number) > 0
      ? (deadlineMs as number)
      : 120_000);

  while (Date.now() < deadline) {
    if (pollingAbort) {
      state.polling = false;
      return;
    }
    await new Promise((resolve) => {
      pollTimer = window.setTimeout(resolve, tick * 1000);
    });
    if (pollingAbort) {
      state.polling = false;
      return;
    }

    try {
      const data = await api.oauth.poll(props.provider, {
        deviceCode,
        codeVerifier,
        extraData,
      });
      if (data.success) {
        pollingAbort = true;
        state.step = "success";
        state.polling = false;
        emit("success");
        return;
      }
      if (data.error === "expired_token" || data.error === "access_denied") {
        throw new Error(
          data.errorDescription || data.error || "Authorization failed",
        );
      }
      if (data.error === "slow_down") tick = Math.min(tick + 5, 30);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Authorization failed";
      state.step = "error";
      state.polling = false;
      return;
    }
  }

  state.error = "Authorization timeout";
  state.step = "error";
  state.polling = false;
}

async function startOAuthFlow() {
  if (!props.provider) return;
  try {
    state.error = "";

    if (DEVICE_CODE_PROVIDERS.includes(props.provider)) {
      state.isDeviceCode = true;
      state.step = "waiting";
      const data = await api.oauth.deviceCode(props.provider);
      state.deviceData = data;

      const verifyUrl = data.verification_uri_complete || data.verification_uri;
      if (verifyUrl) window.open(verifyUrl, "_blank", "noopener,noreferrer");

      const extraData =
        props.provider === "qoder"
          ? {
              _qoderNonce: data._qoderNonce,
              _qoderMachineId: data._qoderMachineId,
              _qoderVerifier: data.codeVerifier,
            }
          : null;
      startPolling(
        data.device_code || data.deviceCode,
        data.codeVerifier,
        data.interval || 5,
        extraData,
        Number.isFinite(data.expires_in) && data.expires_in > 0
          ? data.expires_in * 1000
          : undefined,
      );
      return;
    }

    // Authorization code flow — codex uses its IDE fixed-port redirect.
    const appPort =
      window.location.port ||
      (window.location.protocol === "https:" ? "443" : "80");
    const redirectUri =
      props.provider === "codex"
        ? "http://localhost:1455/auth/callback"
        : props.provider === "deepseek-harness"
          ? `${window.location.origin}/oauth/callback`
          : `http://localhost:${appPort}/callback`;

    const authorizeQuery = new URLSearchParams({ redirect_uri: redirectUri });
    if (props.oauthMeta)
      for (const [key, value] of Object.entries(props.oauthMeta))
        if (value) authorizeQuery.set(key, value);
    const data = await api.oauth.authorize(
      props.provider,
      redirectUri,
      props.oauthMeta || undefined,
    );
    if (!data.authUrl) {
      throw new Error(
        data.flowType === "device_code"
          ? `Provider ${props.provider} uses device-code login but is not wired in the OAuth modal device-code list`
          : "No authorization URL returned from OAuth provider",
      );
    }

    let proxyActive = false;
    let serverSide = false;
    if (props.provider === "codex") {
      try {
        const proxyData = await api.oauth.startProxy(props.provider, {
          app_port: appPort,
          state: String(data.state || ""),
          code_verifier: String(data.codeVerifier || ""),
          redirect_uri: redirectUri,
        });
        proxyActive = Boolean(proxyData.success);
        serverSide = Boolean(proxyData.serverSide);
      } catch {
        proxyActive = false;
      }
    }

    state.authData = {
      ...data,
      redirectUri,
      codexServerSide: props.provider === "codex" && serverSide,
    };
    // Register the relay before opening the provider page.
    installCallbackListeners();

    if (props.provider === "codex" && proxyActive) {
      state.step = "waiting";
      popup = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
      if (!popup) state.step = "input";
    } else if (!isLocalhost.value || props.provider === "codex") {
      state.step = "input";
      window.open(data.authUrl, "_blank");
    } else {
      state.step = "waiting";
      popup = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
      if (!popup) state.step = "input";
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : "OAuth failed";
    state.step = "error";
  }
}

// Server-side proxy mode (codex): poll until auto-exchange.
function startStatusPolling() {
  const pollProvider = state.authData?.codexServerSide ? "codex" : null;
  if (!pollProvider || !state.authData?.state) return;
  if (callbackProcessed) return;
  let attempts = 0;

  const tick = async () => {
    if (callbackProcessed) return;
    attempts += 1;
    try {
      const data = await api.oauth.pollStatus(
        pollProvider!,
        state.authData!.state,
      );
      if (callbackProcessed) return;
      if (data.status === "done") {
        callbackProcessed = true;
        state.step = "success";
        emit("success");
        return;
      }
      if (data.status === "error") {
        callbackProcessed = true;
        state.error = data.error || "Authentication failed";
        state.step = "error";
        return;
      }
    } catch {
      /* network error, keep polling */
    }
    if (attempts >= 200) {
      callbackProcessed = true;
      state.error = "Authentication timeout";
      state.step = "error";
      return;
    }
    pollStatusTimer = window.setTimeout(tick, 1500);
  };
  pollStatusTimer = window.setTimeout(tick, 1500);
}

async function handleCallbackMessage(data: Record<string, any>) {
  if (callbackProcessed) return;
  const {
    code,
    token,
    state: callbackState,
    error: callbackError,
    errorDescription,
  } = data;
  if (callbackError) {
    callbackProcessed = true;
    state.error = errorDescription || callbackError;
    state.step = "error";
    return;
  }
  if (token || code) {
    callbackProcessed = true;
    await exchangeTokensRequest(token || code, callbackState);
  }
}

function installCallbackListeners() {
  window.addEventListener("message", onWindowMessage);
  window.addEventListener("storage", onStorage);
  try {
    const stored = localStorage.getItem("oauth_callback");
    if (stored) {
      const data = JSON.parse(stored);
      if (data.timestamp && Date.now() - data.timestamp < 30000)
        void handleCallbackMessage(data);
      localStorage.removeItem("oauth_callback");
    }
  } catch {
    /* storage unavailable */
  }
}

function onWindowMessage(event: MessageEvent) {
  const localhost =
    event.origin.includes("localhost") || event.origin.includes("127.0.0.1");
  const sameOrigin = event.origin === window.location.origin;
  if (!localhost && !sameOrigin) return;
  if ((event.data as Record<string, unknown>)?.type === "oauth_callback")
    void handleCallbackMessage(
      (event.data as Record<string, unknown>).data as Record<string, unknown>,
    );
}

function onStorage(event: StorageEvent) {
  if (event.key === "oauth_callback" && event.newValue) {
    try {
      void handleCallbackMessage(JSON.parse(event.newValue));
      localStorage.removeItem("oauth_callback");
    } catch {
      /* malformed */
    }
  }
}

function removeCallbackListeners() {
  window.removeEventListener("message", onWindowMessage);
  window.removeEventListener("storage", onStorage);
}

async function handleManualSubmit() {
  try {
    state.error = "";

    const input = state.callbackUrl.trim();

    // Raw JWT access token (starts with eyJ) — skip URL parsing.
    if (input.startsWith("eyJ") && input.includes(".")) {
      await exchangeTokensRequest(input, null);
      return;
    }

    const url = new URL(input);
    const code = url.searchParams.get("code");
    const token = url.searchParams.get("token");
    const callbackState = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");
    if (errorParam)
      throw new Error(url.searchParams.get("error_description") || errorParam);
    if (!code && !token) {
      throw new Error("No authorization code found in URL");
    }
    await exchangeTokensRequest(token || code!, callbackState);
  } catch (err) {
    state.error = err instanceof Error ? err.message : "Connect failed";
    state.step = "error";
  }
}

function stopProxies() {
  if (props.provider === "codex") {
    void api.oauth.stopProxy(props.provider).catch(() => undefined);
  }
}

function handleClose() {
  stopProxies();
  emit("close");
}

watch(
  () => props.open,
  (open) => {
    if (open && props.provider) {
      if (opened) return;
      opened = true;
      Object.assign(state, {
        step: "waiting",
        authData: null,
        callbackUrl: "",
        error: "",
        isDeviceCode: false,
        deviceData: null,
        polling: false,
      });
      pollingAbort = false;
      callbackProcessed = false;
      void startOAuthFlow();
    } else if (!open) {
      pollingAbort = true;
      opened = false;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (pollStatusTimer) window.clearTimeout(pollStatusTimer);
      removeCallbackListeners();
      stopProxies();
    }
  },
  { immediate: true },
);

watch(
  () => state.authData,
  (data) => {
    if (!data) return;
    callbackProcessed = false;
    removeCallbackListeners();
    installCallbackListeners();
    startStatusPolling();
  },
);

onBeforeUnmount(() => {
  pollingAbort = true;
  if (pollTimer) window.clearTimeout(pollTimer);
  if (pollStatusTimer) window.clearTimeout(pollStatusTimer);
  removeCallbackListeners();
  stopProxies();
});
</script>

<template>
  <Modal :open="open" :title="modalTitle" size="lg" @close="handleClose">
    <div class="flex flex-col gap-4">
      <!-- Waiting + manual input combined (auth-code flow) -->
      <template
        v-if="
          (state.step === 'waiting' || state.step === 'input') &&
          !state.isDeviceCode
        "
      >
        <div
          class="flex items-center gap-2 rounded-lg border border-border bg-sidebar/50 px-3 py-2"
        >
          <span
            class="material-symbols-outlined animate-spin text-base text-primary"
            >progress_activity</span
          >
          <span class="text-sm">Waiting for popup authorization…</span>
        </div>

        <div class="my-1 flex items-center gap-3">
          <div class="h-px flex-1 bg-border" />
          <span class="text-xs uppercase tracking-wider text-muted-foreground"
            >Or paste callback URL manually</span
          >
          <div class="h-px flex-1 bg-border" />
        </div>

        <div class="space-y-4">
          <div>
            <p class="mb-2 text-sm font-medium">
              Step 1: Open this URL in your browser
            </p>
            <div class="flex gap-2">
              <Input
                :model-value="state.authData?.authUrl || ''"
                readonly
                class="flex-1 font-mono text-xs"
              />
              <Button
                variant="secondary"
                :disabled="!state.authData?.authUrl"
                @click="copy(state.authData?.authUrl || '', 'auth_url')"
              >
                <span class="material-symbols-outlined text-sm">{{
                  copiedKey === "auth_url" ? "check" : "content_copy"
                }}</span
                >Copy
              </Button>
            </div>
          </div>
          <div>
            <p class="mb-2 text-sm font-medium">
              Step 2: Paste the callback URL here
            </p>
            <p class="mb-2 text-xs text-muted-foreground">
              After authorization, copy the full URL from your browser.
            </p>
            <Input
              v-model="state.callbackUrl"
              :placeholder="placeholderUrl"
              class="font-mono text-xs"
            />
          </div>
        </div>

        <div class="flex gap-2">
          <Button
            class="flex-1"
            :disabled="!state.callbackUrl"
            @click="handleManualSubmit"
            >Connect</Button
          >
          <Button class="flex-1" variant="ghost" @click="handleClose"
            >Cancel</Button
          >
        </div>
      </template>

      <!-- Device code flow -->
      <template
        v-if="
          state.step === 'waiting' && state.isDeviceCode && state.deviceData
        "
      >
        <div class="py-4 text-center">
          <p class="mb-4 text-sm text-muted-foreground">
            Visit the login URL below and authorize:
          </p>
          <div class="mb-4 rounded-lg bg-sidebar p-4">
            <p class="mb-1 text-xs text-muted-foreground">Login URL</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 break-all text-sm">{{ deviceLoginUrl }}</code>
              <Button
                size="sm"
                variant="ghost"
                :disabled="!deviceLoginUrl"
                @click="copy(deviceLoginUrl, 'login_url')"
              >
                <span class="material-symbols-outlined text-sm">{{
                  copiedKey === "login_url" ? "check" : "content_copy"
                }}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                :disabled="!deviceLoginUrl"
                @click="openUrl(deviceLoginUrl)"
                >Open</Button
              >
            </div>
          </div>
          <div class="rounded-lg bg-primary/10 p-4">
            <p class="mb-1 text-xs text-muted-foreground">Your Code</p>
            <div class="flex items-center justify-center gap-2">
              <p class="font-mono text-2xl font-bold text-primary">
                {{ state.deviceData.user_code || state.deviceData.userCode }}
              </p>
              <Button
                size="sm"
                variant="ghost"
                @click="
                  copy(
                    String(
                      state.deviceData.user_code ||
                        state.deviceData.userCode ||
                        '',
                    ),
                    'user_code',
                  )
                "
              >
                <span class="material-symbols-outlined text-sm">{{
                  copiedKey === "user_code" ? "check" : "content_copy"
                }}</span>
              </Button>
            </div>
          </div>
        </div>
        <div
          v-if="state.polling"
          class="flex items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <span class="material-symbols-outlined animate-spin"
            >progress_activity</span
          >
          Waiting for authorization...
        </div>
      </template>

      <!-- Success -->
      <div v-if="state.step === 'success'" class="py-6 text-center">
        <div
          class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
        >
          <span class="material-symbols-outlined text-3xl text-green-600"
            >check_circle</span
          >
        </div>
        <h3 class="mb-2 text-lg font-semibold">Connected Successfully!</h3>
        <p class="mb-4 text-sm text-muted-foreground">
          Your {{ providerName }} account has been connected.
        </p>
        <Button class="w-full" @click="handleClose">Done</Button>
      </div>

      <!-- Error -->
      <div v-if="state.step === 'error'" class="py-6 text-center">
        <div
          class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
        >
          <span class="material-symbols-outlined text-3xl text-red-600"
            >error</span
          >
        </div>
        <h3 class="mb-2 text-lg font-semibold">Connection Failed</h3>
        <p class="mb-4 text-sm text-red-600">{{ state.error }}</p>
        <div class="flex gap-2">
          <Button class="flex-1" variant="secondary" @click="startOAuthFlow"
            >Try Again</Button
          >
          <Button class="flex-1" variant="ghost" @click="handleClose"
            >Cancel</Button
          >
        </div>
      </div>
    </div>
  </Modal>
</template>
