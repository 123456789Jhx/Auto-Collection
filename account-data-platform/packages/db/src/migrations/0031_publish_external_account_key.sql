ALTER TABLE "publish_account_bindings" ADD COLUMN "external_account_key" varchar(255);
--> statement-breakpoint
UPDATE "publish_account_bindings"
SET "external_account_key" = "account_name"
WHERE "external_account_key" IS NULL OR btrim("external_account_key") = '';
--> statement-breakpoint
ALTER TABLE "publish_account_bindings" ALTER COLUMN "external_account_key" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_publish_account_bindings_active_external_account_key"
ON "publish_account_bindings" USING btree ("tenant_id", "platform", "external_account_key")
WHERE "enabled" = true AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "publish_run_bindings" ADD COLUMN "external_account_key" varchar(255);
--> statement-breakpoint
UPDATE "publish_run_bindings"
SET "external_account_key" = "account_name"
WHERE "external_account_key" IS NULL OR btrim("external_account_key") = '';
--> statement-breakpoint
ALTER TABLE "publish_run_bindings" ALTER COLUMN "external_account_key" SET NOT NULL;
