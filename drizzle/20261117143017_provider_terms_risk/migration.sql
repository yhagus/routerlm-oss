ALTER TABLE "providers" ADD COLUMN "terms_risk" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Kimi Code and MiniMax M Plan ship flagged in the Catalog. The seeder never
-- changes existing Providers, so an install that already has them gets the flag here.
UPDATE "providers" SET "terms_risk" = true WHERE "slug" IN ('kimi-code', 'minimax-m-plan');
