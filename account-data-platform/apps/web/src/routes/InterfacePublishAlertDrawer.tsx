import { CheckOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  List,
  Modal,
  Radio,
  Space,
  Tag,
  Typography
} from "antd";
import { useState } from "react";
import type { InterfacePublishMonitorAlert } from "../lib/api-client-interface-publish-monitor";

type Props = {
  open: boolean;
  alerts: InterfacePublishMonitorAlert[];
  alertContexts: Record<string, InterfacePublishAlertContext>;
  loading?: boolean;
  onClose: () => void;
  onMarkRead: (alertId: string) => void;
  onResolveResult: (
    publishTaskId: string,
    resolution: "PUBLISHED" | "FAILED",
    evidence: string
  ) => void;
  onResolveClaim: (slotExecutionId: string, evidence: string) => void;
};

export type InterfacePublishAlertContext = {
  accountName: string;
  deviceCode: string;
  publishTaskId: string;
};

type Resolution = "PUBLISHED" | "FAILED";

function detailId(alert: InterfacePublishMonitorAlert, key: string) {
  const value = alert.detailsJson?.[key];
  return typeof value === "string" ? value : null;
}

export function InterfacePublishAlertDrawer({
  open,
  alerts,
  alertContexts,
  loading,
  onClose,
  onMarkRead,
  onResolveResult,
  onResolveClaim
}: Props) {
  const { message } = AntdApp.useApp();
  const [selected, setSelected] = useState<InterfacePublishMonitorAlert | null>(null);
  const [evidence, setEvidence] = useState("");
  const [resolution, setResolution] = useState<Resolution>("PUBLISHED");
  const selectedContext = selected ? alertContexts[selected.id] : null;

  function beginResolution(alert: InterfacePublishMonitorAlert) {
    setSelected(alert);
    setEvidence("");
    setResolution("PUBLISHED");
  }

  function submitResolution() {
    const proof = evidence.trim();
    if (!selected || !proof) {
      message.error("请填写人工核对证据");
      return;
    }
    const isClaimUnknown = selected.code === "CLAIM_RESULT_UNKNOWN";
    const publishTaskId = detailId(selected, "publishTaskId");
    if (!isClaimUnknown && !publishTaskId) {
      message.error("告警缺少本地发布任务 ID");
      return;
    }
    if (isClaimUnknown && !selected.slotExecutionId) {
      message.error("告警缺少时段执行 ID");
      return;
    }

    Modal.confirm({
      title: isClaimUnknown ? "确认解除领取暂停" : "确认实际发布结果",
      icon: <ExclamationCircleOutlined />,
      content: isClaimUnknown
        ? "解除后账号可能再次领取素材，请确认已核对外部系统，避免重复领取风险。"
        : `将本地结果确认成“${resolution === "PUBLISHED" ? "实际成功" : "实际失败"}”，此操作不会直接调用外部接口。`,
      okText: "确认提交",
      cancelText: "取消",
      onOk: () => {
        // [AIR-FILL: Q-006] Only evidence-backed SAFE_TO_RETRY can release claim isolation.
        if (isClaimUnknown) onResolveClaim(selected.slotExecutionId!, proof);
        else onResolveResult(publishTaskId!, resolution, proof);
        setSelected(null);
      }
    });
  }

  return (
    <>
      <Drawer title="接口发布告警" open={open} onClose={onClose} width={560}>
        {alerts.length === 0 ? <Empty description="当前没有告警" /> : (
          <List
            loading={loading}
            dataSource={alerts}
            renderItem={(alert) => (
              <List.Item
                actions={[
                  !alert.readAt ? (
                    <Button key="read" type="text" icon={<CheckOutlined />} onClick={() => onMarkRead(alert.id)}>
                      标记已读
                    </Button>
                  ) : null,
                  ["RESULT_UNKNOWN", "CLAIM_RESULT_UNKNOWN"].includes(alert.code) && !alert.resolvedAt ? (
                    <Button key="resolve" type="link" onClick={() => beginResolution(alert)}>人工处理</Button>
                  ) : null
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  title={<Space wrap><Tag color={alert.severity === "ERROR" ? "red" : "gold"}>{alert.code}</Tag>{alert.message}</Space>}
                  description={(
                    <Space direction="vertical" size={2}>
                      <Typography.Text type="secondary">{new Date(alert.createdAt).toLocaleString()}</Typography.Text>
                      {alert.resolvedAt ? <Tag color="green">已处理</Tag> : <Tag>待处理</Tag>}
                    </Space>
                  )}
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      <Modal
        title={selected?.code === "CLAIM_RESULT_UNKNOWN" ? "核对未知领取结果" : "核对未知发布结果"}
        open={Boolean(selected)}
        okText="下一步"
        cancelText="取消"
        onOk={submitResolution}
        onCancel={() => setSelected(null)}
      >
        <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="账号">{selectedContext?.accountName || "-"}</Descriptions.Item>
          <Descriptions.Item label="设备">{selectedContext?.deviceCode || "-"}</Descriptions.Item>
          <Descriptions.Item label="本地任务">{selectedContext?.publishTaskId || "-"}</Descriptions.Item>
        </Descriptions>
        {selected?.code === "CLAIM_RESULT_UNKNOWN" ? (
          <Alert
            type="warning"
            showIcon
            message="SAFE_TO_RETRY"
            description="请先在外部管理端确认没有未处理的领取结果；解除暂停存在重复领取风险。"
            style={{ marginBottom: 16 }}
          />
        ) : (
          <Radio.Group value={resolution} onChange={(event) => setResolution(event.target.value)} style={{ marginBottom: 16 }}>
            <Radio.Button value="PUBLISHED">实际成功</Radio.Button>
            <Radio.Button value="FAILED">实际失败</Radio.Button>
          </Radio.Group>
        )}
        <Input.TextArea
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="填写核对位置、时间和结果证据"
        />
      </Modal>
    </>
  );
}
