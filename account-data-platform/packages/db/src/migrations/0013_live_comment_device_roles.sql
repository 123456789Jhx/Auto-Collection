ALTER TABLE device_task_configs ADD COLUMN IF NOT EXISTS live_comment_role varchar(32) NOT NULL DEFAULT 'none';
ALTER TABLE device_task_configs ADD COLUMN IF NOT EXISTS live_comment_group varchar(16);
ALTER TABLE device_task_configs ADD COLUMN IF NOT EXISTS followed_account_name varchar(100);
ALTER TABLE device_task_configs ADD COLUMN IF NOT EXISTS followed_account_id varchar(100);
ALTER TABLE device_task_configs ADD COLUMN IF NOT EXISTS followed_aliases jsonb;

COMMENT ON COLUMN device_task_configs.live_comment_role IS '直播评论角色：none/followed/follower';
COMMENT ON COLUMN device_task_configs.live_comment_group IS '跟随号回复组：A/B/C';
COMMENT ON COLUMN device_task_configs.followed_account_name IS '目标号昵称，用于跟随号识别目标评论作者';
COMMENT ON COLUMN device_task_configs.followed_account_id IS '目标号 ID/抖音号，用于高置信匹配';
COMMENT ON COLUMN device_task_configs.followed_aliases IS '目标号别名列表，用于昵称变体匹配';

CREATE INDEX IF NOT EXISTS idx_device_task_configs_tenant_task_live_comment_role
  ON device_task_configs(tenant_id, task_id, live_comment_role)
  WHERE deleted_at IS NULL;
