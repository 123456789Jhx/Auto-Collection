import { Table, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import type { TableRowSelection } from "antd/es/table/interface";
import type { BizScriptDevice } from "@pkg/types";
import { deviceStateLabels, formatBizDate } from "./biz-script-workflow";

export function HashValue({ value }: { value: string | null }) {
  if (!value) return <>-</>;
  return <Typography.Text code copyable={{ text: value }} style={{ overflowWrap: "anywhere" }}>{value}</Typography.Text>;
}

const columns: TableColumnsType<BizScriptDevice> = [
  { title: "设备", dataIndex: "deviceCode", width: 160, render: (value: string, device) => <><Typography.Text strong>{device.deviceName || value}</Typography.Text><div>{device.deviceName ? value : null}{!device.enabled ? <Tag>已停用</Tag> : null}</div></> },
  { title: "当前加载版本", dataIndex: "currentVersion", width: 175, render: (value) => value || "-" },
  { title: "加载来源", dataIndex: "source", width: 110, render: (value) => value === "overlay" ? <Tag color="blue">覆盖层</Tag> : value === "baseline" ? <Tag>APK 基线</Tag> : "未上报" },
  { title: "待加载版本", dataIndex: "pendingVersion", width: 175, render: (value) => value || "-" },
  { title: "目标版本", dataIndex: "targetVersion", width: 175, render: (value) => value || "-" },
  { title: "设备状态", dataIndex: "state", width: 135, render: (state: BizScriptDevice["state"]) => <Tag color={state === "CURRENT" ? "green" : state === "FAILED" || state === "REJECTED" ? "red" : state === "PENDING_RESTART" ? "orange" : "default"}>{deviceStateLabels[state]}</Tag> },
  { title: "实际业务指纹", dataIndex: "sourceSha256", width: 170, ellipsis: true, render: (value: string | null) => <Tooltip title={value}>{value || "-"}</Tooltip> },
  { title: "基座兼容标识", dataIndex: "baseCompatibilityId", width: 170, ellipsis: true, render: (value: string | null) => <Tooltip title={value}>{value || "-"}</Tooltip> },
  { title: "最近心跳", dataIndex: "lastHeartbeatAt", width: 185, render: (value: string | null, device) => <><div>{formatBizDate(value)}</div><Typography.Text type={device.fresh ? "secondary" : "warning"}>{device.fresh ? "在线" : "已过期"}</Typography.Text></> },
  { title: "设备上报", dataIndex: "eventMessage", width: 230, render: (value) => <span style={{ overflowWrap: "anywhere" }}>{value || "-"}</span> }
];

export function BizScriptDeviceTable({ devices, loading, rowSelection }: {
  devices: BizScriptDevice[];
  loading?: boolean;
  rowSelection?: TableRowSelection<BizScriptDevice>;
}) {
  return <Table<BizScriptDevice> rowKey="deviceId" size="small" columns={columns} dataSource={devices} loading={loading}
    rowSelection={rowSelection} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 1680 }} locale={{ emptyText: "暂无业务运行状态" }} />;
}
