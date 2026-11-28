ALTER TABLE "usage_logs" ADD COLUMN "is_reasoning_streamed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "finish_reason" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "max_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "reasoning_effort" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "thinking_budget_tokens" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "tool_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "tool_call_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "image_count" integer;