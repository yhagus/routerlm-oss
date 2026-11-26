-- The Catalog's TokenHarbor entry now names the error code with which
-- TokenHarbor refuses a model outside a Provider Account's Plan. The seeder
-- never changes existing Providers, so an install that already has
-- TokenHarbor gets it here, unless an operator already set not-in-plan codes.
UPDATE "providers" SET "quirks" = "quirks" || '{"notInPlanErrorCodes":["model_not_in_plan"]}'::jsonb WHERE "slug" = 'tokenharbor' AND "is_from_catalog" = true AND NOT ("quirks" ? 'notInPlanErrorCodes');
