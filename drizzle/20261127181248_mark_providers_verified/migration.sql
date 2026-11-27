ALTER TABLE "providers" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "providers" SET "verified" = true, "verified_at" = '2026-11-26T00:00:00Z'
WHERE "is_from_catalog" = true AND "slug" = 'tokenharbor';--> statement-breakpoint
UPDATE "providers" SET "verified" = true, "verified_at" = '2026-11-22T00:00:00Z'
WHERE "is_from_catalog" = true AND "slug" = 'clinepass';
