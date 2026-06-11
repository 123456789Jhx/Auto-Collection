WITH ranked_log_files AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, device_id, log_date, file_name
      ORDER BY uploaded_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC
    ) AS row_no
  FROM device_log_files
  WHERE deleted_at IS NULL
)
UPDATE device_log_files
SET
  deleted_at = now(),
  updated_at = now(),
  updated_by = 'migration'
WHERE id IN (
  SELECT id
  FROM ranked_log_files
  WHERE row_no > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_device_log_files_tenant_device_date_name"
ON "device_log_files" ("tenant_id", "device_id", "log_date", "file_name")
WHERE "deleted_at" IS NULL;
