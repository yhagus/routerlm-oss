DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM model_groups WHERE slug = 'upstream') THEN
    RAISE EXCEPTION 'The Model Group slug "upstream" is now reserved for Direct Upstream Access (ADR 0102). Change that Model Group''s slug, upgrade, then tell its clients the new names.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "direct_upstream_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "direct_upstream_access" boolean DEFAULT false NOT NULL;
