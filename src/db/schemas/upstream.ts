import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { at, createdAt, id, updatedAt } from "./columns.js";

// Upstream: Providers, the Provider Accounts the gateway holds at them, and
// the Upstream Models they sell.

export const UPSTREAM_PROTOCOLS = [
  "openai-chat",
  "anthropic-messages",
  "openai-responses",
] as const;
export type UpstreamProtocol = (typeof UPSTREAM_PROTOCOLS)[number];

/** How a Provider expects the Provider Account key: `Authorization: Bearer` or an `x-api-key` header. */
export const AUTH_STYLES = ["bearer", "x-api-key"] as const;
export type AuthStyle = (typeof AUTH_STYLES)[number];

export const CAPABILITIES = ["vision", "tools", "reasoning", "structured-output"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** The quota endpoint shapes the gateway can read (ADR 0010); a Provider names one, or none. */
export const QUOTA_READERS = ["minimax-m-plan", "kimi-code"] as const;
export type QuotaReaderName = (typeof QUOTA_READERS)[number];

/** The credential a Provider Account holds (GLOSSARY: Provider Account, OAuth Login). */
export const CREDENTIAL_KINDS = ["api-key", "oauth-login"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** Where the User's account at the Provider lives; each region signs in at its own auth host. */
export const OAUTH_REGIONS = ["global", "china"] as const;
export type OauthRegion = (typeof OAUTH_REGIONS)[number];

/**
 * What signing in to a Provider needs (ADR 0012): the device-code flow is
 * code, and everything that names the Provider is this data.
 */
export interface ProviderOauthLogin {
  /** The auth host of each region, without a path. */
  authHosts: Record<OauthRegion, string>;
  clientId: string;
  /** The version of the Provider's own CLI the gateway presents itself as. */
  cliVersion: string;
}

/** What a Quota Meter's `used` and `limit` count. */
export const QUOTA_METER_UNITS = ["percent", "count", "tokens", "usd"] as const;
export type QuotaMeterUnit = (typeof QUOTA_METER_UNITS)[number];

/**
 * Per-Provider configuration for small deviations from its Protocol (ADR 0003).
 * The Protocol adapters own its keys; the database only stores the object.
 */
export type ProviderQuirks = Record<string, unknown>;

/** USD per million tokens. Six decimals hold prices below a cent per million. */
const pricePerMillionTokens = (name: string) =>
  numeric(name, { precision: 12, scale: 6, mode: "number" });

export const providers = pgTable("providers", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // A key into the logo set the dashboard owns; null shows no logo.
  logo: text("logo"),
  protocol: text("protocol", { enum: UPSTREAM_PROTOCOLS }).notNull(),
  baseUrl: text("base_url").notNull(),
  authStyle: text("auth_style", { enum: AUTH_STYLES }).notNull(),
  quirks: jsonb("quirks").$type<ProviderQuirks>().notNull().default({}),
  // Null for a Provider that reports no quota, such as a pay-as-you-go API.
  quotaReader: text("quota_reader", { enum: QUOTA_READERS }),
  // Null for a Provider that offers no OAuth Login: its Provider Accounts hold API keys only.
  oauthLogin: jsonb("oauth_login").$type<ProviderOauthLogin>(),
  // The credentials its Provider Accounts may hold. An OAuth Login also needs
  // `oauthLogin`; a Subscription Provider without API keys lists only it.
  credentialKinds: text("credential_kinds", { enum: CREDENTIAL_KINDS })
    .array()
    .notNull()
    .default(["api-key", "oauth-login"]),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isFromCatalog: boolean("is_from_catalog").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const providerAccounts = pgTable(
  "provider_accounts",
  {
    id: id(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    credentialKind: text("credential_kind", { enum: CREDENTIAL_KINDS })
      .notNull()
      .default("api-key"),
    // AES-256-GCM ciphertext; the dashboard only ever shows keyLastFour.
    // Both are null when the account holds an OAuth Login.
    encryptedKey: text("encrypted_key"),
    keyLastFour: text("key_last_four"),
    // The OAuth Login, null when the account holds an API key. Both tokens
    // are AES-256-GCM ciphertext and never leave the gateway.
    oauthEncryptedAccessToken: text("oauth_encrypted_access_token"),
    oauthEncryptedRefreshToken: text("oauth_encrypted_refresh_token"),
    // When the auth host granted the access token, and when it stops working:
    // together they tell its lifetime, which decides when the gateway renews it.
    oauthGrantedAt: at("oauth_granted_at"),
    oauthExpiresAt: at("oauth_expires_at"),
    oauthRegion: text("oauth_region", { enum: OAUTH_REGIONS }),
    // Generated once for the account and sent with every call made as the Provider's CLI.
    oauthDeviceId: text("oauth_device_id"),
    // Lower runs first.
    priority: integer("priority").notNull().default(0),
    isEnabled: boolean("is_enabled").notNull().default(true),
    // Set when the gateway disables the account: an upstream 401 or 403, or an
    // OAuth Login the Provider no longer renews. Null when an operator did.
    disabledReason: text("disabled_reason"),
    lastError: text("last_error"),
    lastErrorAt: at("last_error_at"),
    // Keep serving while Exhausted, when the Provider bills the excess some other way.
    continueWhenExhausted: boolean("continue_when_exhausted").notNull().default(false),
    // When its Quota Meters were last read, successfully or not.
    quotaCheckedAt: at("quota_checked_at"),
    // Why the last reading failed; null after a successful one.
    quotaError: text("quota_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("provider_accounts_provider_id_priority_idx").on(table.providerId, table.priority),
    // The credential kind and the filled columns never disagree: an API key
    // account holds a key and no tokens, an OAuth Login account the reverse.
    check(
      "provider_accounts_credential_kind_check",
      sql`(${table.credentialKind} = 'api-key'
          and ${table.encryptedKey} is not null
          and ${table.oauthEncryptedAccessToken} is null
          and ${table.oauthEncryptedRefreshToken} is null)
        or (${table.credentialKind} = 'oauth-login'
          and ${table.encryptedKey} is null
          and ${table.oauthEncryptedAccessToken} is not null
          and ${table.oauthEncryptedRefreshToken} is not null)`,
    ),
  ],
);

/**
 * The latest reading of one Quota Meter of a Provider Account (ADR 0010),
 * replaced on every reading. There is no history.
 */
export const quotaMeters = pgTable(
  "quota_meters",
  {
    id: id(),
    providerAccountId: uuid("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id, { onDelete: "cascade" }),
    // Such as `5h`, `weekly` or `weekly:video`; unique per Provider Account.
    key: text("key").notNull(),
    label: text("label").notNull(),
    unit: text("unit", { enum: QUOTA_METER_UNITS }).notNull(),
    // Null when the Provider reports only a percentage.
    used: numeric("used", { mode: "number" }),
    limit: numeric("limit", { mode: "number" }),
    remainingPercent: numeric("remaining_percent", { mode: "number" }),
    isUnlimited: boolean("is_unlimited").notNull().default(false),
    windowSeconds: integer("window_seconds"),
    resetsAt: at("resets_at"),
    // The model group the meter counts, such as `video`; null when it counts every model.
    scope: text("scope"),
    observedAt: at("observed_at").notNull(),
    // The Provider's own entry the meter was read from, with what the row doesn't hold.
    raw: jsonb("raw").$type<unknown>().notNull(),
  },
  (table) => [
    unique("quota_meters_provider_account_id_key_unique").on(table.providerAccountId, table.key),
  ],
);

export const upstreamModels = pgTable(
  "upstream_models",
  {
    id: id(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    // The model name as the Provider spells it in requests.
    upstreamModelId: text("upstream_model_id").notNull(),
    // The name the Provider's docs give the model; null when they give none.
    name: text("name"),
    capabilities: text("capabilities", { enum: CAPABILITIES }).array("[]").notNull().default([]),
    contextSize: integer("context_size").notNull(),
    maxOutputTokens: integer("max_output_tokens"),
    // Null when the Provider doesn't publish a price; Cost is then left empty.
    inputPrice: pricePerMillionTokens("input_price"),
    outputPrice: pricePerMillionTokens("output_price"),
    cacheReadPrice: pricePerMillionTokens("cache_read_price"),
    cacheWritePrice: pricePerMillionTokens("cache_write_price"),
    // The day the Provider made the model available, as YYYY-MM-DD.
    releaseDate: date("release_date", { mode: "string" }),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("upstream_models_provider_id_upstream_model_id_unique").on(
      table.providerId,
      table.upstreamModelId,
    ),
  ],
);
