-- The Catalog now lists the Plans these Providers sell. The seeder never
-- changes existing Providers, so an install that already has them gets the
-- lists here, unless an operator already listed Plans.
UPDATE "providers" SET "plans" = '[{"value":"Agent Pass","name":"Agent Pass"},{"value":"Office Pass","name":"Office Pass"},{"value":"Frontier Pass","name":"Frontier Pass"}]'::jsonb, "allows_no_plan" = true WHERE "slug" = 'tokenharbor' AND "is_from_catalog" = true AND "plans" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "providers" SET "plans" = '[{"value":"free","name":"Free"},{"value":"go","name":"Go"},{"value":"plus","name":"Plus"},{"value":"prolite","name":"Pro"},{"value":"pro","name":"Pro (More)"},{"value":"promax","name":"Pro (Max)"},{"value":"team","name":"Team"},{"value":"business","name":"Business"}]'::jsonb, "allows_no_plan" = false WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true AND "plans" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "providers" SET "plans" = '[{"value":"Go","name":"Go"},{"value":"Go Plus","name":"Go Plus"},{"value":"Go Teams","name":"Go Teams"}]'::jsonb, "allows_no_plan" = false WHERE "slug" = 'opencode-go' AND "is_from_catalog" = true AND "plans" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "providers" SET "plans" = '[{"value":"Plus","name":"Plus"},{"value":"Pro","name":"Pro"},{"value":"Andante","name":"Andante"},{"value":"Moderato","name":"Moderato"},{"value":"Allegretto","name":"Allegretto"}]'::jsonb, "allows_no_plan" = false WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true AND "plans" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "providers" SET "plans" = '[{"value":"Go","name":"Go"},{"value":"Explore","name":"Explore"},{"value":"Build","name":"Build"}]'::jsonb, "allows_no_plan" = false WHERE "slug" = 'minimax-m-plan' AND "is_from_catalog" = true AND "plans" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "providers" SET "plans" = '[{"value":"Lite","name":"Lite"},{"value":"Pro","name":"Pro"},{"value":"Max","name":"Max"},{"value":"Team","name":"Team"}]'::jsonb, "allows_no_plan" = false WHERE "slug" = 'zai-coding-plan' AND "is_from_catalog" = true AND "plans" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "providers" SET "plans" = '[{"value":"Lite","name":"Lite"},{"value":"Essential","name":"Essential"},{"value":"Standard","name":"Standard"},{"value":"Pro","name":"Pro"},{"value":"Team Standard","name":"Team Standard"},{"value":"Team Advanced","name":"Team Advanced"},{"value":"Team Premium","name":"Team Premium"}]'::jsonb, "allows_no_plan" = false WHERE "slug" = 'alibaba-token-plan' AND "is_from_catalog" = true AND "plans" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "providers" SET "plans" = '[{"value":"Lite","name":"Lite"},{"value":"Standard","name":"Standard"},{"value":"Pro","name":"Pro"},{"value":"Max","name":"Max"},{"value":"Team Standard","name":"Team Standard"},{"value":"Team Pro","name":"Team Pro"},{"value":"Team Max","name":"Team Max"}]'::jsonb, "allows_no_plan" = false WHERE "slug" = 'xiaomi-mimo-token-plan' AND "is_from_catalog" = true AND "plans" = '[]'::jsonb;
