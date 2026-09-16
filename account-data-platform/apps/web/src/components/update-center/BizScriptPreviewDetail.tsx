import { PlayCircleOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { BizScriptDevice, BizScriptPreview } from "@pkg/types";
import { getPromotionBlocker, stageLabels } from "./biz-script-workflow";
import { HashValue } from "./BizScriptDeviceTable";

export type PreviewAction = "test" | "promote" | "revoke";

export function BizScriptPreviewDetail({ preview, devices, blocked, busy, onAction }: {
  preview: BizScriptPreview;
  devices: BizScriptDevice[];
  blocked: string | null;
  busy: boolean;
  onAction: (action: PreviewAction) => void;
}) {
  const promotionBlocker = blocked || getPromotionBlocker(preview, devices);
  const changes = [
    ...preview.changes.added.map((path) => ({ path, label: "新增", color: "green" })),
    ...preview.changes.modified.map((path) => ({ path, label: "修改", color: "blue" })),
    ...preview.changes.removed.map((path) => ({ path, label: "删除", color: "red" }))
  ];
  return <>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <Space wrap><Typography.Text strong>版本 {preview.version}</Typography.Text><Tag color={preview.stage === "PROMOTED" ? "green" : preview.stage === "TESTING" ? "blue" : "default"}>{stageLabels[preview.stage]}</Tag></Space>
      <Space wrap>
        {preview.stage === "DRAFT" ? <Tooltip title={blocked}><Button icon={<PlayCircleOutlined />} disabled={!!blocked || busy} onClick={() => onAction("test")}>选择试运行设备</Button></Tooltip> : null}
        {preview.stage === "TESTING" ? <Tooltip title={promotionBlocker}><Button type="primary" icon={<SendOutlined />} disabled={!!promotionBlocker || busy} onClick={() => onAction("promote")}>选择推广设备</Button></Tooltip> : null}
        {preview.stage !== "REVOKED" ? <Button danger icon={<StopOutlined />} disabled={busy} onClick={() => onAction("revoke")}>撤回</Button> : null}
      </Space>
    </div>
    {preview.stage === "TESTING" && promotionBlocker ? <Alert type="warning" showIcon message={promotionBlocker} style={{ marginBottom: 16 }} /> : null}
    <Descriptions size="small" column={{ xs: 1, sm: 1, md: 2 }} items={[
      { key: "baseline", label: "比较基线版本", children: preview.baselineVersion },
      { key: "build", label: "APK Build ID", children: preview.apkBuildId },
      { key: "size", label: "完整业务包", children: `${preview.files.length} 个文件 / ${(preview.sizeBytes / 1024).toFixed(1)} KiB` },
      { key: "scope", label: "设备范围", children: `试运行 ${preview.testDeviceIds.length} 台 / 推广 ${preview.deviceIds.length} 台` },
      { key: "base", label: "基座兼容标识", span: 2, children: <HashValue value={preview.baseCompatibilityId} /> },
      { key: "source", label: "业务指纹", span: 2, children: <HashValue value={preview.sourceSha256} /> },
      { key: "package", label: "业务包 SHA-256", span: 2, children: <HashValue value={preview.packageSha256} /> },
      { key: "note", label: "发布说明", span: 2, children: <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview.releaseNote || "-"}</span> }
    ]} />
    {preview.stage === "REVOKED" ? <Alert type="warning" showIcon message="已停止后续下发；设备当前加载版本以心跳为准" style={{ marginBlock: 16 }} /> : null}
    <Typography.Title level={5}>相对 APK 基线的文件变更</Typography.Title>
    <Table rowKey="path" size="small" dataSource={changes} pagination={{ pageSize: 8, hideOnSinglePage: true }} locale={{ emptyText: "业务文件与比较基线一致" }} columns={[
      { title: "变更", dataIndex: "label", width: 80, render: (label: string, row) => <Tag color={row.color}>{label}</Tag> },
      { title: "文件路径", dataIndex: "path", render: (path: string) => <span style={{ overflowWrap: "anywhere" }}>{path}</span> }
    ]} />
  </>;
}
