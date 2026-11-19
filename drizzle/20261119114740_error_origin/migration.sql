ALTER TABLE "attempts" ADD COLUMN "upstream_request_id" text;--> statement-breakpoint
ALTER TABLE "error_captures" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "error_captures" ADD COLUMN "client_ip" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "error_origin" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "client_ip" text;--> statement-breakpoint
CREATE INDEX "usage_logs_error_origin_created_at_idx" ON "usage_logs" ("error_origin","created_at");--> statement-breakpoint
-- Backfill the Error Origin of existing failed Usage Logs from their error
-- code (spec #76; ADR 0031 records why new rows don't derive it this way).
-- "Failed" is the Usage page's definition: not cancelled, and an error code or
-- a status of 400 or above. Cancelled and successful rows stay null. An
-- `invalid_request` with an Attempt was the Provider's upstream 400; without
-- one, the gateway refused the body itself. Status 500 or above with no code
-- was a gateway fault.
UPDATE "usage_logs" SET "error_origin" = CASE
    WHEN "error_code" IN ('upstream_rate_limited', 'upstream_error', 'upstream_timeout') THEN 'upstream'
    WHEN "error_code" = 'invalid_request'
      AND EXISTS (SELECT 1 FROM "attempts" WHERE "attempts"."usage_log_id" = "usage_logs"."id") THEN 'upstream'
    WHEN "error_code" IS NULL AND "http_status" >= 500 THEN 'gateway'
    ELSE 'client'
  END
WHERE NOT "is_cancelled" AND ("error_code" IS NOT NULL OR "http_status" >= 400);
