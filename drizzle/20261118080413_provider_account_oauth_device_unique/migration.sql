-- Two polls of one sign-in could each create an account. Keep, per sign-in,
-- the account that served a request most recently (the oldest when none did),
-- move the others' history onto it, and delete the rest.
CREATE TEMPORARY TABLE "duplicate_provider_accounts" AS
SELECT "id", first_value("id") OVER (
  PARTITION BY "provider_id", "oauth_device_id"
  ORDER BY (SELECT max("created_at") FROM "usage_logs" WHERE "usage_logs"."provider_account_id" = "provider_accounts"."id") DESC NULLS LAST,
    "created_at" ASC,
    "id" ASC
) AS "kept_id"
FROM "provider_accounts"
WHERE "oauth_device_id" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "duplicate_provider_accounts" WHERE "id" = "kept_id";
--> statement-breakpoint
UPDATE "usage_logs" SET "provider_account_id" = "kept_id"
FROM "duplicate_provider_accounts" WHERE "usage_logs"."provider_account_id" = "duplicate_provider_accounts"."id";
--> statement-breakpoint
UPDATE "attempts" SET "provider_account_id" = "kept_id"
FROM "duplicate_provider_accounts" WHERE "attempts"."provider_account_id" = "duplicate_provider_accounts"."id";
--> statement-breakpoint
DELETE FROM "provider_accounts" WHERE "id" IN (SELECT "id" FROM "duplicate_provider_accounts");
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_accounts_provider_id_oauth_device_id_unique" ON "provider_accounts" ("provider_id","oauth_device_id");
--> statement-breakpoint
DROP TABLE "duplicate_provider_accounts";
