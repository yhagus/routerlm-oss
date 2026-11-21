DROP INDEX "usage_logs_integration_id_sequence_idx";--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "transaction_id" xid8 DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_logs_integration_id_transaction_id_sequence_idx" ON "usage_logs" ("integration_id","transaction_id","sequence");