import { SettingOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Popover, Progress, Slider, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { updateBaseConnectivityThreshold } from "../../lib/api-client";

type BaseConnectivityState = {
  status: "ONLINE" | "RECONNECTING" | "OFFLINE";
  elapsedSeconds: number | null;
  offlineThresholdSeconds: number;
};

type BaseConnectivityStatusProps = BaseConnectivityState & {
  deviceCode: string;
  reconnectProgressPercent: number;
};

export function baseConnectivityLabel(state: BaseConnectivityState) {
  if (state.status === "ONLINE") return "在线";
  if (state.status === "RECONNECTING") {
    return `正在重新连接 ${state.elapsedSeconds ?? 0} / ${state.offlineThresholdSeconds} 秒`;
  }
  return "离线等待接入";
}

const thresholdMarks = {
  15: "15",
  30: "30",
  60: "60",
  90: "90",
  120: "120",
  150: "150"
};

export function BaseConnectivityStatus({
  deviceCode,
  status,
  elapsedSeconds,
  offlineThresholdSeconds,
  reconnectProgressPercent
}: BaseConnectivityStatusProps) {
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState(offlineThresholdSeconds);
  const [saving, setSaving] = useState(false);

  useEffect(() => setThreshold(offlineThresholdSeconds), [offlineThresholdSeconds]);

  async function saveThreshold(value: number) {
    setSaving(true);
    try {
      await updateBaseConnectivityThreshold(deviceCode, value);
      await queryClient.invalidateQueries({ queryKey: ["remote-wake-devices"] });
    } finally {
      setSaving(false);
    }
  }

  const content = (
    <div style={{ width: 320, padding: "4px 8px 12px" }}>
      <Typography.Text strong>离线判定上限：{threshold} 秒</Typography.Text>
      <Slider
        min={15}
        max={150}
        step={1}
        marks={thresholdMarks}
        value={threshold}
        disabled={saving}
        onChange={setThreshold}
        onAfterChange={(value) => void saveThreshold(value)}
      />
    </div>
  );

  const color = status === "ONLINE" ? "success" : status === "RECONNECTING" ? "processing" : "default";
  return (
    <Space size={6} wrap>
      <div style={{ minWidth: status === "RECONNECTING" ? 220 : undefined }}>
        <Tag color={color}>{baseConnectivityLabel({ status, elapsedSeconds, offlineThresholdSeconds })}</Tag>
        {status === "RECONNECTING" ? (
          <Progress
            percent={reconnectProgressPercent}
            size="small"
            showInfo={false}
            status="active"
          />
        ) : null}
      </div>
      <Popover trigger="click" placement="bottomLeft" content={content}>
        <Button
          type="text"
          size="small"
          icon={<SettingOutlined />}
          aria-label="设置离线判定时间"
        />
      </Popover>
    </Space>
  );
}
