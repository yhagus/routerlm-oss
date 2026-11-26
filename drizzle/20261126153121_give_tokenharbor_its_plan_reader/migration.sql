-- The Catalog's TokenHarbor entry now names a plan reader. The seeder never
-- changes existing Providers, so an install that already has TokenHarbor gets
-- it here, unless an operator already set one.
UPDATE "providers" SET "plan_reader" = 'tokenharbor' WHERE "slug" = 'tokenharbor' AND "is_from_catalog" = true AND "plan_reader" IS NULL;
