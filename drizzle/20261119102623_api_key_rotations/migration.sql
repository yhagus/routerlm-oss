CREATE TABLE "api_key_rotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"api_key_id" uuid NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_by_id" uuid,
	"previous_key_id" text NOT NULL,
	"new_key_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_key_rotations_api_key_id_rotated_at_idx" ON "api_key_rotations" ("api_key_id","rotated_at");--> statement-breakpoint
ALTER TABLE "api_key_rotations" ADD CONSTRAINT "api_key_rotations_api_key_id_api_keys_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "api_key_rotations" ADD CONSTRAINT "api_key_rotations_rotated_by_id_users_id_fkey" FOREIGN KEY ("rotated_by_id") REFERENCES "users"("id") ON DELETE SET NULL;