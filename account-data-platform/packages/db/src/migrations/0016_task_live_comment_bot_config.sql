ALTER TABLE collection_tasks ADD COLUMN IF NOT EXISTS live_comment_bot_config jsonb;

COMMENT ON COLUMN collection_tasks.live_comment_bot_config IS '任务模板级直播聊天机器人默认配置，可被设备级配置覆盖';
