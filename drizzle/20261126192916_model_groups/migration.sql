CREATE TABLE "model_group_members" (
	"model_id" uuid,
	"model_group_id" uuid,
	CONSTRAINT "model_group_members_pkey" PRIMARY KEY("model_id","model_group_id")
);
--> statement-breakpoint
CREATE TABLE "model_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "requested_model_name" text;--> statement-breakpoint
CREATE INDEX "model_group_members_model_group_id_idx" ON "model_group_members" ("model_group_id");--> statement-breakpoint
ALTER TABLE "model_group_members" ADD CONSTRAINT "model_group_members_model_id_models_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "model_group_members" ADD CONSTRAINT "model_group_members_model_group_id_model_groups_id_fkey" FOREIGN KEY ("model_group_id") REFERENCES "model_groups"("id") ON DELETE CASCADE;