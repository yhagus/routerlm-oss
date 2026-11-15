<script setup lang="ts">
import { TriangleAlert } from "@lucide/vue";
import { computed } from "vue";
import type { Provider, ProviderAccount, UpstreamModel } from "~/lib/upstream";

/**
 * What a direct Upstream Model test will do before anything is sent: no Model,
 * no Routes, no Parameter Policy, and the Provider Accounts it can go through.
 */
const props = defineProps<{
  provider: Provider;
  upstreamModel: UpstreamModel;
  /** This Provider's accounts, in the order the gateway tries them. */
  accounts: ProviderAccount[];
}>();

const usableAccounts = computed(() => props.accounts.filter((account) => account.isEnabled));

/** Why the test can't be served, or null when it can. */
const blocker = computed(() => {
  if (!props.provider.isEnabled) return "Provider disabled";
  if (!props.upstreamModel.isEnabled) return "Upstream Model disabled";
  if (usableAccounts.value.length === 0) return "No enabled Provider Account";
  return null;
});

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** An account's state as the gateway will see it when this request arrives. */
function accountState(account: ProviderAccount): { label: string; tone: "good" | "warn" | null } {
  if (!account.isEnabled) {
    return {
      label: account.disabledReason ? `Disabled: ${account.disabledReason}` : "Disabled",
      tone: "warn",
    };
  }
  if (account.cooldownEndsAt && new Date(account.cooldownEndsAt) > new Date()) {
    return {
      label: `Cooling down until ${timeFormat.format(new Date(account.cooldownEndsAt))}`,
      tone: "warn",
    };
  }
  return { label: "Ready", tone: "good" };
}

/** Which credential the account holds: an API key by its ending, or an OAuth Login. */
function credentialNote(account: ProviderAccount): string {
  return account.credentialKind === "oauth-login"
    ? "OAuth Login"
    : `Key ending ${account.keyLastFour}`;
}
</script>

<template>
  <div class="route-preview">
    <section class="route-preview__section" aria-labelledby="upstream-preview-target">
      <header class="route-preview__heading">
        <h2 id="upstream-preview-target">Direct to {{ upstreamModel.upstreamModelId }}</h2>
        <p v-if="blocker" class="route-preview__warn">
          <TriangleAlert :size="13" /> {{ blocker }}, so a request fails.
        </p>
        <p v-else>
          Skips Models and Routes. Sent as-is, with no Parameter Policy: only the parameters you set
          go upstream.
        </p>
      </header>
      <ol class="route-list">
        <li class="route-list__item" :class="{ 'route-list__item--blocked': blocker }">
          <span class="route-list__order" aria-hidden="true" />
          <ProviderLogo
            class="provider-mark--sm"
            :slug="provider.slug"
            :name="provider.name"
            :base-url="provider.baseUrl"
          />
          <span class="route-list__body">
            <strong>{{ upstreamModel.upstreamModelId }}</strong>
            <span class="route-list__meta">
              {{ provider.name }} · {{ usableAccounts.length }} of {{ accounts.length }}
              {{ accounts.length === 1 ? "account" : "accounts" }} enabled
            </span>
          </span>
          <span class="route-list__tags">
            <span v-if="blocker" class="status-badge status-badge--warn">{{ blocker }}</span>
            <template v-else>
              <span
                v-for="capability in upstreamModel.capabilities"
                :key="capability"
                class="chip"
                >{{ capability }}</span
              >
            </template>
          </span>
        </li>
      </ol>
    </section>

    <section
      v-if="accounts.length > 0"
      class="route-preview__section"
      aria-labelledby="upstream-preview-accounts"
    >
      <header class="route-preview__heading">
        <h2 id="upstream-preview-accounts">Provider Accounts</h2>
        <p>Tried in this order; an account that fails or is exhausted falls back to the next.</p>
      </header>
      <ol class="route-list">
        <li
          v-for="(account, index) in accounts"
          :key="account.id"
          class="route-list__item route-list__item--account"
          :class="{ 'route-list__item--blocked': !account.isEnabled }"
        >
          <span class="route-list__order tabular" aria-hidden="true">{{ index + 1 }}</span>
          <span class="route-list__body">
            <strong>{{ account.name }}</strong>
            <span class="route-list__meta tabular">{{ credentialNote(account) }}</span>
          </span>
          <span class="route-list__tags">
            <span
              class="status-badge"
              :class="
                accountState(account).tone === 'good' ? 'status-badge--good' : 'status-badge--warn'
              "
              >{{ accountState(account).label }}</span
            >
          </span>
        </li>
      </ol>
    </section>
  </div>
</template>
