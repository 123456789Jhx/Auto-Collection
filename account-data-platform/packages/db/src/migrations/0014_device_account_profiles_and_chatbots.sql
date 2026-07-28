ALTER TABLE collector_devices ADD COLUMN IF NOT EXISTS account_profile jsonb;

ALTER TABLE device_task_configs ADD COLUMN IF NOT EXISTS live_comment_mode varchar(32) NOT NULL DEFAULT 'agri_chatbot';
ALTER TABLE device_task_configs ADD COLUMN IF NOT EXISTS live_comment_bot_config jsonb;

COMMENT ON COLUMN collector_devices.account_profile IS '设备登录账号画像：地区身份、农产品、经验背景、说话风格和禁用表达';
COMMENT ON COLUMN device_task_configs.live_comment_mode IS '直播评论模式：off/target_follow/agri_chatbot';
COMMENT ON COLUMN device_task_configs.live_comment_bot_config IS '设备在当前任务中的直播聊天机器人配置';

CREATE INDEX IF NOT EXISTS idx_device_task_configs_tenant_live_comment_mode
  ON device_task_configs(tenant_id, live_comment_mode)
  WHERE deleted_at IS NULL;
