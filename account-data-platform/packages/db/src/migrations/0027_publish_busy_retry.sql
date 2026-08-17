ALTER TABLE "publish_tasks" ADD COLUMN IF NOT EXISTS "failure_code" varchar(64);
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN IF NOT EXISTS "dispatch_retry_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN IF NOT EXISTS "next_dispatch_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN IF NOT EXISTS "last_dispatch_attempt_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_publish_tasks_tenant_busy_retry"
ON "publish_tasks" USING btree ("tenant_id","status","next_dispatch_at");