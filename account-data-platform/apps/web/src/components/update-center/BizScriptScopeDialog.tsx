import { useState } from "react";
import { Alert, Button, Modal, Space, Typography } from "antd";
import type { BizScriptDevice, BizScriptPreview } from "@pkg/types";
import { BizScriptDeviceTable } from "./BizScriptDeviceTable";
import { getDeviceScopeBlocker, getPromotionBlocker } from "./biz-script-workflow";
import type { PreviewAction } from "./BizScriptPreviewDetail";

export function BizScriptScopeDialog({ preview, action, devices, blocked, busy, error, onCancel, onConfirm }: {
  preview: BizScriptPreview;
  action: PreviewAction;
  devices: BizScriptDevice[];
  blocked: string | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (deviceIds: string[]) => void;
}) {
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const label = action === "test" ? "试运行" : action === "promote" ? "推广" : "撤回";
  const selected = deviceIds.map((id) => devices.find((device) => device.deviceId === id));
  const selectionBlocker = selected.some((device) => !device || getDeviceScopeBlocker(device, preview)) ? "所选设备状态已变化，请重新选择" : null;
  const promotionBlocker = action === "promote" ? getPromotionBlocker(preview, devices) : null;
  const blocker = action === "revoke" ? null : blocked || selectionBlocker || promotionBlocker;
  const finalStep = confirming || action === "revoke";
  return <Modal open width={finalStep ? 620 : 1050} title={`${finalStep ? "确认" : "选择"}${label}${finalStep ? "" : "设备"}`}
    onCancel={() => { if (!busy) onCancel(); }} closable={!busy} maskClosable={!busy} footer={
      <Space wrap>
        <Button disabled={busy} onClick={onCancel}>取消</Button>
        {confirming && action !== "revoke" ? <Button disabled={busy} onClick={() => setConfirming(false)}>返回选择</Button> : null}
        <Button type="primary" danger={action === "revoke"} loading={busy}
          disabled={!!blocker || (action !== "revoke" && !deviceIds.length)}
          onClick={() => finalStep ? onConfirm(deviceIds) : setConfirming(true)}>
          {finalStep ? `确认${label}` : `下一步（${deviceIds.length} 台）`}
        </Button>
      </Space>
    }>
    <Typography.Paragraph>业务版本：<Typography.Text strong>{preview.version}</Typography.Text></Typography.Paragraph>
    {error || blocker ? <Alert type="error" showIcon message={error || blocker} style={{ marginBottom: 12 }} /> : null}
    {action === "revoke" ? <Alert type="warning" showIcon message="撤回后停止后续下发，已下载或正在运行的设备不会自动回滚。" /> : finalStep ? <>
      <Typography.Paragraph>本次{label}设备：{deviceIds.length} 台</Typography.Paragraph>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>{selected.map((device, index) => <div key={deviceIds[index]} style={{ paddingBlock: 4, overflowWrap: "anywhere" }}>
        {device ? `${device.deviceName || device.deviceCode} (${device.deviceCode})` : deviceIds[index]}
      </div>)}</div>
    </> : <BizScriptDeviceTable devices={devices} rowSelection={{
      selectedRowKeys: deviceIds,
      onChange: (keys) => setDeviceIds(keys.map(String)),
      getCheckboxProps: (device) => ({ disabled: !!getDeviceScopeBlocker(device, preview), title: getDeviceScopeBlocker(device, preview) || undefined })
    }} />}
  </Modal>;
}
