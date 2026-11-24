import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { SERVICE_TIERS, type ServiceTier } from "@/inference/models/internal-format.js";
import { at, createdAt, id, updatedAt } from "./columns.js";

export const UPSTREAM_PROTOCOLS = [
  "openai-chat",
  "anthropic-messages",
  "openai-responses",
  "dashscope-image",
  "dashscope-video",
  "dashscope-speech",
  "dashscope-transcription",
] as const;
export type UpstreamProtocol = (typeof UPSTREAM_PROTOCOLS)[number];

export const MODEL_KINDS = ["chat", "image", "speech", "transcription", "video"] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export const PROTOCOL_KINDS = {
  "openai-chat": "chat",
  "anthropic-messages": "chat",
  "openai-responses": "chat",
  "dashscope-image": "image",
  "dashscope-video": "video",
  "dashscope-speech": "speech",
  "dashscope-transcription": "transcription",
} as const satisfies Record<UpstreamProtocol, ModelKind>;

export interface ProviderEndpoint {
  kind: ModelKind;
  protocol: UpstreamProtocol;
  baseUrl: string;
}

export const AUTH_STYLES = ["bearer", "x-api-key"] as const;
export type AuthStyle = (typeof AUTH_STYLES)[number];

export const CAPABILITIES = [
  "vision",
  "tools",
  "reasoning",
  "structured-output",
  "text-to-video",
  "first-frame",
  "last-frame",
  "reference-images",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const QUOTA_READERS = ["minimax-m-plan", "kimi-code", "openai-codex"] as const;
export type QuotaReaderName = (typeof QUOTA_READERS)[number];

export const CREDENTIAL_KINDS = ["api-key", "oauth-login"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const OAUTH_REGIONS = ["global", "china"] as const;
export type OauthRegion = (typeof OAUTH_REGIONS)[number];

export const OAUTH_LOGIN_FLOWS = ["kimi-code", "openai-codex"] as const;
export type OauthLoginFlow = (typeof OAUTH_LOGIN_FLOWS)[number];

export interface KimiCodeOauthLogin {
  flow: "kimi-code";
  authHosts: Record<OauthRegion, string>;
  clientId: string;
  cliVersion: string;
}

export interface OpenAiCodexOauthLogin {
  flow: "openai-codex";
  issuer: string;
  clientId: string;
  cliVersion: string;
}

export type ProviderOauthLogin = KimiCodeOauthLogin | OpenAiCodexOauthLogin;

export const QUOTA_METER_UNITS = ["percent", "count", "tokens", "usd"] as const;
export type QuotaMeterUnit = (typeof QUOTA_METER_UNITS)[number];

export type ProviderQuirks = Record<string, unknown>;

export const PROTOCOLS_WITH_SERVICE_TIERS = [
  "openai-chat",
  "openai-responses",
] as const satisfies readonly UpstreamProtocol[];

export type ServiceTierValues = Partial<Record<ServiceTier, string>>;

export interface TierPrices {
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
}

const wallClockDateTime = customType<{ data: string; driverData: string }>({
  dataType: () => "timestamp",
  fromDriver: (stored) => stored.slice(0, "YYYY-MM-DD HH:MM".length).replace(" ", "T"),
});

const pricePerMillionTokens = (name: string) =>
  numeric(name, { precision: 12, scale: 6, mode: "number" });

const pricePerUnit = (name: string) => numeric(name, { precision: 14, scale: 8, mode: "number" });

export type PricesByTier = Record<string, number>;

export const providers = pgTable(
  "providers",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    logo: text("logo"),
    termsRisk: boolean("terms_risk").notNull().default(false),
    endpoints: jsonb("endpoints").$type<ProviderEndpoint[]>().notNull(),
    authStyle: text("auth_style", { enum: AUTH_STYLES }).notNull(),
    quirks: jsonb("quirks").$type<ProviderQuirks>().notNull().default({}),
    serviceTierValues: jsonb("service_tier_values")
      .$type<ServiceTierValues>()
      .notNull()
      .default({}),
    quotaReader: text("quota_reader", { enum: QUOTA_READERS }),
    oauthLogin: jsonb("oauth_login").$type<ProviderOauthLogin>(),
    credentialKinds: text("credential_kinds", { enum: CREDENTIAL_KINDS })
      .array()
      .notNull()
      .default(["api-key", "oauth-login"]),
    isEnabled: boolean("is_enabled").notNull().default(true),
    isFromCatalog: boolean("is_from_catalog").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "providers_service_tier_values_protocol_check",
      sql`${table.serviceTierValues} = '{}'::jsonb
      or ${sql.join(
        PROTOCOLS_WITH_SERVICE_TIERS.map(
          (protocol) =>
            sql`${table.endpoints} @> ${sql.raw(`'[{"kind":"chat","protocol":"${protocol}"}]'`)}::jsonb`,
        ),
        sql` or `,
      )}`,
    ),
  ],
);

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
    encryptedKey: text("encrypted_key"),
    keyLastFour: text("key_last_four"),
    oauthEncryptedAccessToken: text("oauth_encrypted_access_token"),
    oauthEncryptedRefreshToken: text("oauth_encrypted_refresh_token"),
    oauthGrantedAt: at("oauth_granted_at"),
    oauthExpiresAt: at("oauth_expires_at"),
    oauthRegion: text("oauth_region", { enum: OAUTH_REGIONS }),
    oauthDeviceId: text("oauth_device_id"),
    oauthEncryptedIdToken: text("oauth_encrypted_id_token"),
    oauthAccountId: text("oauth_account_id"),
    oauthEmail: text("oauth_email"),
    oauthPlanType: text("oauth_plan_type"),
    priority: integer("priority").notNull().default(0),
    isEnabled: boolean("is_enabled").notNull().default(true),
    disabledReason: text("disabled_reason"),
    lastError: text("last_error"),
    lastErrorAt: at("last_error_at"),
    continueWhenExhausted: boolean("continue_when_exhausted").notNull().default(false),
    quotaCheckedAt: at("quota_checked_at"),
    quotaError: text("quota_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("provider_accounts_provider_id_priority_idx").on(table.providerId, table.priority),
    uniqueIndex("provider_accounts_provider_id_oauth_device_id_unique").on(
      table.providerId,
      table.oauthDeviceId,
    ),
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

export const quotaMeters = pgTable(
  "quota_meters",
  {
    id: id(),
    providerAccountId: uuid("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    unit: text("unit", { enum: QUOTA_METER_UNITS }).notNull(),
    used: numeric("used", { mode: "number" }),
    limit: numeric("limit", { mode: "number" }),
    remainingPercent: numeric("remaining_percent", { mode: "number" }),
    isUnlimited: boolean("is_unlimited").notNull().default(false),
    windowSeconds: integer("window_seconds"),
    resetsAt: at("resets_at"),
    scope: text("scope"),
    observedAt: at("observed_at").notNull(),
    raw: jsonb("raw").$type<unknown>().notNull(),
  },
  (table) => [
    unique("quota_meters_provider_account_id_key_unique").on(table.providerAccountId, table.key),
  ],
);

export const usageResets = pgTable(
  "usage_resets",
  {
    id: id(),
    providerAccountId: uuid("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    grantedAt: at("granted_at").notNull(),
    expiresAt: at("expires_at"),
    observedAt: at("observed_at").notNull(),
    raw: jsonb("raw").$type<unknown>().notNull(),
  },
  (table) => [
    unique("usage_resets_provider_account_id_external_id_unique").on(
      table.providerAccountId,
      table.externalId,
    ),
  ],
);

export const upstreamModels = pgTable(
  "upstream_models",
  {
    id: id(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    upstreamModelId: text("upstream_model_id").notNull(),
    name: text("name"),
    kind: text("kind", { enum: MODEL_KINDS }).notNull().default("chat"),
    capabilities: text("capabilities", { enum: CAPABILITIES }).array("[]").notNull().default([]),
    contextSize: integer("context_size"),
    maxOutputTokens: integer("max_output_tokens"),
    inputPrice: pricePerMillionTokens("input_price"),
    outputPrice: pricePerMillionTokens("output_price"),
    cacheReadPrice: pricePerMillionTokens("cache_read_price"),
    cacheWritePrice: pricePerMillionTokens("cache_write_price"),
    pricePerImage: pricePerUnit("price_per_image"),
    pricePerImageBySize: jsonb("price_per_image_by_size").$type<PricesByTier>(),
    pricePerInputImage: pricePerUnit("price_per_input_image"),
    pricePerSecondByResolution: jsonb("price_per_second_by_resolution").$type<PricesByTier>(),
    pricePerMillionCharacters: pricePerUnit("price_per_million_characters"),
    pricePerAudioSecond: pricePerUnit("price_per_audio_second"),
    maxInputImages: integer("max_input_images"),
    minDurationSeconds: integer("min_duration_seconds"),
    maxDurationSeconds: integer("max_duration_seconds"),
    resolutions: text("resolutions").array(),
    sizes: text("sizes").array(),
    serviceTiers: text("service_tiers", { enum: SERVICE_TIERS }).array().notNull().default([]),
    tierPrices: jsonb("tier_prices")
      .$type<Partial<Record<ServiceTier, TierPrices>>>()
      .notNull()
      .default({}),
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
    check(
      "upstream_models_tier_prices_listed_check",
      sql`(${table.tierPrices} - ${table.serviceTiers}) = '{}'::jsonb`,
    ),
  ],
);

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PricingWindowRange {
  weekdays: IsoWeekday[];
  start: string;
  end: string;
}

export const pricingWindows = pgTable("pricing_windows", {
  id: id(),
  name: text("name").notNull().unique(),
  timeZone: text("time_zone").notNull(),
  ranges: jsonb("ranges").$type<PricingWindowRange[]>().notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const upstreamModelPricingWindows = pgTable(
  "upstream_model_pricing_windows",
  {
    id: id(),
    upstreamModelId: uuid("upstream_model_id")
      .notNull()
      .references(() => upstreamModels.id, { onDelete: "cascade" }),
    pricingWindowId: uuid("pricing_window_id")
      .notNull()
      .references(() => pricingWindows.id, { onDelete: "cascade" }),
    inputPrice: pricePerMillionTokens("input_price"),
    outputPrice: pricePerMillionTokens("output_price"),
    cacheReadPrice: pricePerMillionTokens("cache_read_price"),
    cacheWritePrice: pricePerMillionTokens("cache_write_price"),
    validFrom: wallClockDateTime("valid_from"),
    validUntil: wallClockDateTime("valid_until"),
  },
  (table) => [
    check(
      "upstream_model_pricing_windows_validity_check",
      sql`${table.validFrom} < ${table.validUntil}`,
    ),
    check(
      "upstream_model_pricing_windows_price_check",
      sql`${table.inputPrice} is not null
        or ${table.outputPrice} is not null
        or ${table.cacheReadPrice} is not null
        or ${table.cacheWritePrice} is not null`,
    ),
  ],
);
