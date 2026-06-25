WITH ranked_device_tokens AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, device_token
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS token_rank
  FROM collector_devices
  WHERE device_token IS NOT NULL
    AND deleted_at IS NULL
)
UPDATE collector_devices AS device
SET
  device_token = NULL,
  updated_at = now(),
  updated_by = 'migration_0017'
FROM ranked_device_tokens AS ranked
WHERE device.id = ranked.id
  AND ranked.token_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_collector_devices_tenant_device_token
  ON collector_devices (tenant_id, device_token)
  WHERE device_token IS NOT NULL AND deleted_at IS NULL;
