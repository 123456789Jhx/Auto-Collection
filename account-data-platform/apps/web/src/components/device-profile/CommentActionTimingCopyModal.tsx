import { useEffect, useState } from "react";
import { Alert, App as AntdApp, Button, Checkbox, Collapse, Empty, Input, Modal, Spin, Table, Typography } from "antd";
import { ArrowRightOutlined, CopyOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { getDevices } from "../../lib/api-client";
import { copyCommentActionTiming, getCommentActionTiming, type CommentActionTiming, type TimingResponse } from "../../lib/api-client-comment-action-timing";
import { hasCompleteTiming, timingDifferences, timingDraft } from "../../lib/comment-action-timing-form";

type Device = { deviceCode: string; deviceName?: string; platform?: string };
type Props = {
  open: boolean;
  source: Device;
  timing: CommentActionTiming;
  updatedAt: string | null;
  onClose: () => void;
};

export function CommentActionTimingCopyModal({ open, source, timing, updatedAt, onClose }: Props) {
  const { message } = AntdApp.useApp();
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, TimingResponse>>({});
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<Array<{ deviceCode: string; ok: boolean; error?: string }>>([]);
  const [search, setSearch] = useState("");
  const [loadSequence, setLoadSequence] = useState(0);
  const [previewSequence, setPreviewSequence] = useState(0);
  const platform = source.platform || "douyin";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSelected([]); setSnapshots({}); setResults([]); setError(""); setSearch(""); setDevices([]); setLoading(true);
    getDevices().then((list) => {
      if (cancelled) return;
      setDevices((list as Device[]).filter((device) => device.deviceCode && device.deviceCode !== source.deviceCode && (!device.platform || device.platform === platform)));
    }).catch((cause: Error) => { if (!cancelled) setError(cause.message || "设备列表读取失败，请重新读取。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, source.deviceCode, platform, loadSequence]);

  useEffect(() => {
    setSnapshots({}); setResults([]);
    if (!open || !selected.length) { setPreviewing(false); return; }
    let cancelled = false;
    setPreviewing(true); setError("");
    Promise.all(selected.map((code) => getCommentActionTiming(code, platform))).then((items) => {
      if (!cancelled) setSnapshots(Object.fromEntries(items.map((item) => [item.deviceCode, item])));
    }).catch((cause: Error) => { if (!cancelled) setError(`无法读取目标设备的配置，未允许复制：${cause.message}`); })
      .finally(() => { if (!cancelled) setPreviewing(false); });
    return () => { cancelled = true; };
  }, [open, selected, platform, previewSequence]);

  const ready = selected.length > 0 && selected.every((code) => snapshots[code]);
  const copyDisabled = !timing.enabled || !hasCompleteTiming(timing) || !ready || loading || previewing || Boolean(error) || results.length > 0;
  const query = search.trim().toLocaleLowerCase();
  const visibleDevices = devices.filter((device) => `${device.deviceName || ""} ${device.deviceCode}`.toLocaleLowerCase().includes(query));

  function selectDevices(values: string[]) {
    setSnapshots({}); setResults([]); setError("");
    setSelected(values);
  }

  function retryPreview() {
    if (submitting) return;
    const failed = results.filter((item) => !item.ok).map((item) => item.deviceCode);
    if (failed.length) selectDevices(failed);
    else { setSnapshots({}); setResults([]); setError(""); }
    setPreviewSequence((value) => value + 1);
  }

  async function copy() {
    if (submitting || copyDisabled) return;
    setSubmitting(true); setError("");
    try {
      const result = await copyCommentActionTiming({
        sourceDeviceCode: source.deviceCode, platform, expectedUpdatedAt: updatedAt,
        targets: selected.map((deviceCode) => ({ deviceCode, expectedUpdatedAt: snapshots[deviceCode].updatedAt }))
      });
      setResults(result.results);
      const successful = result.results.filter((item) => item.ok).length;
      if (successful === selected.length) {
        message.success(`已为 ${successful} 台设备保存动作间隔，等待配置刷新。`);
        onClose();
      }
    } catch (cause) {
      setError((cause as Error).message || "复制失败，请重新读取差异后重试。");
    } finally { setSubmitting(false); }
  }

  return (
    <Modal className="cat-copy-modal" title={<span className="cat-title"><CopyOutlined /> 复制动作间隔配置</span>}
      open={open} width={960} onCancel={() => { if (!submitting) onClose(); }} onOk={copy}
      okText={`确认复制到 ${selected.length} 台设备`} cancelText="取消" confirmLoading={submitting}
      okButtonProps={{ disabled: copyDisabled }} keyboard={!submitting}
      cancelButtonProps={{ disabled: submitting }} closable={!submitting} maskClosable={!submitting}>
      <div className="cat-copy-flow"><div><span>来源设备</span><strong>{source.deviceName || source.deviceCode}</strong></div>
        <ArrowRightOutlined /><div><span>目标设备</span><strong>已选择 <b>{selected.length}</b> 台</strong></div></div>
      <p className="cat-copy-description">复制已保存的动作间隔，每台设备独立保存一份。选择设备后，可逐项查看变化。</p>
      {error ? <Alert showIcon type="error" message={error} action={<Button size="small" disabled={submitting || loading || previewing}
        onClick={selected.length ? retryPreview : () => setLoadSequence((value) => value + 1)}>重新读取</Button>} /> : null}
      <div className="cat-copy-workspace">
        <section className="cat-copy-picker" aria-label="选择目标设备">
          <div className="cat-copy-section-title"><strong>选择目标设备</strong><span>{devices.length} 台可选</span></div>
          <Input aria-label="搜索目标设备" allowClear prefix={<SearchOutlined />} placeholder="搜索设备名称或编号"
            value={search} disabled={submitting} onChange={(event) => setSearch(event.target.value)} />
          {loading ? <div className="cat-copy-loading"><Spin size="small" /><span>读取设备列表</span></div> : devices.length ? <>
            <div className="cat-copy-select-tools"><span>已选 {selected.length} 台</span><Button type="link" size="small" disabled={submitting || !selected.length} onClick={() => selectDevices([])}>清空选择</Button></div>
            {visibleDevices.length ? <Checkbox.Group className="cat-copy-devices" value={selected} disabled={submitting}
              onChange={(values) => {
                const visibleCodes = new Set(visibleDevices.map((device) => device.deviceCode));
                selectDevices([...selected.filter((code) => !visibleCodes.has(code)), ...(values as string[]).filter((code) => visibleCodes.has(code))]);
              }}>
              {visibleDevices.map((device) => <Checkbox key={device.deviceCode} value={device.deviceCode}>
                <span className="cat-copy-device-name">{device.deviceName || device.deviceCode}</span>
                {device.deviceName ? <small>{device.deviceCode}</small> : null}
              </Checkbox>)}
            </Checkbox.Group> : <Empty description="没有匹配的设备" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </> : <Empty description="暂无其他可选设备" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </section>
        <section className="cat-copy-preview" aria-label="配置变化预览">
          <div className="cat-copy-section-title"><strong>配置变化预览</strong><Button type="text" size="small" icon={<ReloadOutlined />}
            disabled={submitting || loading || previewing || !selected.length} onClick={retryPreview}>重新读取</Button></div>
          {previewing ? <div className="cat-copy-loading"><Spin size="small" /><span>读取目标配置并比较</span></div> : ready ?
            <Collapse className="cat-copy-diff" items={selected.map((code) => {
              const device = devices.find((item) => item.deviceCode === code);
              const changes = timingDifferences(timing, timingDraft(snapshots[code]));
              return {
                key: code, label: <span className="cat-diff-label"><strong>{device?.deviceName || code}</strong><span>{changes.length} 处变化</span></span>,
                children: changes.length ? <Table size="small" pagination={false} rowKey="label" dataSource={changes}
                  columns={[{ title: "动作间隔", dataIndex: "label" }, { title: "当前", dataIndex: "before" }, { title: "复制后", dataIndex: "after" }]} />
                  : <Typography.Text type="secondary">等待区间相同，复制后仍会独立保存一份配置。</Typography.Text>
              };
            })} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={selected.length ? "读取完成后显示配置变化" : "选择左侧设备，查看复制后的变化"} />}
        </section>
      </div>
      {results.length ? <Alert type="warning" showIcon message="复制结果" description={results.map((item) => <div key={item.deviceCode}>{devices.find((device) => device.deviceCode === item.deviceCode)?.deviceName || item.deviceCode}：{item.ok ? "已保存，等待配置刷新" : item.error || "保存失败"}</div>)}
        action={<Button size="small" disabled={submitting} onClick={retryPreview}>重新读取失败设备</Button>} /> : null}
    </Modal>
  );
}
