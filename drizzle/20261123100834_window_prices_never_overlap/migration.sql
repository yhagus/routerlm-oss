-- A model's Window Prices may no longer overlap (ADR 0040). The DST-aware
-- overlap check runs in the gateway, not in SQL, so any Upstream Model with
-- two or more attachments might hold a conflict this upgrade can't settle.
-- Stop before changing anything and name them; the operator detaches the
-- extras, upgrades, and attaches them again under the new check.
DO $$
DECLARE
  conflicts text;
BEGIN
  SELECT string_agg(
      format('%s (%s): %s', upstream_models.upstream_model_id, providers.name, attached.window_names),
      '; ' ORDER BY upstream_models.upstream_model_id)
    INTO conflicts
    FROM (
      SELECT attachment.upstream_model_id,
        string_agg(pricing_windows.name, ', ' ORDER BY pricing_windows.name) AS window_names
      FROM upstream_model_pricing_windows attachment
      JOIN pricing_windows ON pricing_windows.id = attachment.pricing_window_id
      GROUP BY attachment.upstream_model_id
      HAVING count(*) > 1
    ) attached
    JOIN upstream_models ON upstream_models.id = attached.upstream_model_id
    JOIN providers ON providers.id = upstream_models.provider_id;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Window Prices may no longer overlap (ADR 0040), and these Upstream Models attach more than one Pricing Window: %. Detach all but one from each, upgrade, then attach the others again.', conflicts;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "upstream_model_pricing_windows" DROP CONSTRAINT "upstream_model_pricing_windows_model_window_unique";--> statement-breakpoint
ALTER TABLE "upstream_model_pricing_windows" DROP CONSTRAINT "upstream_model_pricing_windows_model_position_unique";--> statement-breakpoint
ALTER TABLE "upstream_model_pricing_windows" DROP COLUMN "position";