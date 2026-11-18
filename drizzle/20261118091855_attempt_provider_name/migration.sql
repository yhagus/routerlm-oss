ALTER TABLE "attempts" ADD COLUMN "provider_name" text;--> statement-breakpoint
-- Attempts whose Provider is gone keep a null name.
UPDATE "attempts" SET "provider_name" = "providers"."name"
FROM "providers" WHERE "providers"."slug" = "attempts"."provider_slug";
