import { useEffect, useState } from "react";
import { Alert, App as AntdApp, Button, InputNumber, Modal, Space, Spin, Switch, Tabs } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, CopyOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { getCommentActionTiming, updateCommentActionTiming, type ActionKey, type CommentActionTiming, type TimingPair } from "../../lib/api-client-comment-action-timing";
import { adjacentWait, COMMENT_ACTIONS, formatRange, hasCompleteTiming, timingDraft, validateTiming, type CommentTimingDraft } from "../../lib/comment-action-timing-form";
import { CommentActionTimingCopyModal } from "./CommentActionTimingCopyModal";
import "./comment-action-timing.css";

type Device = { deviceCode: string; deviceName?: string; platform?: string };
type Props = { open: boolean; device: Device; onClose: () => void; onSaved?: (timing: CommentActionTiming | null, updatedAt: string | null, previousUpdatedAt: string | null) => void };
const groups = [...new Set(COMMENT_ACTIONS.map((action) => action.group))];
const groupHints = ["从启动应用到找到直播", "确认人数与商品入口", "打开主页并读取身份", "读取评论、翻页与切换"];

function RangeInput({ label, value, disabled, onChange }: {
  label: string; value: [number, number]; disabled: boolean; onChange: (index: 0 | 1, value: number | null) => void;
}) {
  return <div className="cat-range">
    <span className="cat-range-label">{label}</span>
    <InputNumber aria-label={`${label}最短毫秒`} min={0} max={120000} step={1} precision={0} disabled={disabled}
      value={Number.isFinite(value[0]) ? value[0] : null} placeholder="最短" onChange={(next) => onChange(0, next)} />
    <span className="cat-range-dash">—</span>
    <InputNumber aria-label={`${label}最长毫秒`} min={0} max={120000} step={1} precision={0} disabled={disabled}
      value={Number.isFinite(value[1]) ? value[1] : null} placeholder="最长" onChange={(next) => onChange(1, next)} />
    <small>ms</small>
  </div>;
}

export function CommentActionTimingPanel({ open, device, onClose, onSaved }: Props) {
  const { message, modal } = AntdApp.useApp();
  const platform = device.platform || "douyin";
  const [timing, setTiming] = useState<CommentTimingDraft>(() => timingDraft());
  const [baseline, setBaseline] = useState<CommentTimingDraft>(() => timingDraft());
  const [deviceDefaults, setDeviceDefaults] = useState<CommentTimingDraft>(() => timingDraft());
  const [saved, setSaved] = useState<CommentActionTiming | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadSequence, setLoadSequence] = useState(0);
  const [lastSaved, setLastSaved] = useState(false);
  const [activeGroup, setActiveGroup] = useState(groups[0]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoaded(false); setLoading(true); setError(""); setLastSaved(false); setCopyOpen(false); setActiveGroup(groups[0]);
    getCommentActionTiming(device.deviceCode, platform).then((response) => {
      if (cancelled) return;
      const resolved = timingDraft(response);
      setDeviceDefaults(timingDraft({ timing: null, openDouyinWaitMs: response.openDouyinWaitMs }));
      setTiming(resolved); setBaseline(resolved); setSaved(response.timing); setUpdatedAt(response.updatedAt); setLoaded(true);
    }).catch((cause: Error) => { if (!cancelled) setError(cause.message || "读取失败，请重试。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, device.deviceCode, platform, loadSequence]);

  const dirty = JSON.stringify(timing) !== JSON.stringify(baseline);
  const needsSave = dirty || !hasCompleteTiming(saved);
  const validation = validateTiming(timing);
  const busy = loading || saving || copyOpen;
  const status = !loaded ? loading ? "正在读取设备配置" : "配置未读取成功"
    : lastSaved ? "已保存，等待设备配置刷新" : dirty ? "有未保存的修改"
      : saved ? "已读取本设备保存的配置" : "使用默认值，可修改后保存";
  function changePair(key: ActionKey, side: keyof TimingPair, index: 0 | 1, value: number | null) {
    setLastSaved(false);
    setTiming((prior) => {
      const current = prior.actions[key] || { beforeMs: [0, 0], afterMs: [0, 0] };
      const range = [...current[side]] as [number, number];
      range[index] = value ?? Number.NaN;
      return { ...prior, actions: { ...prior.actions, [key]: { ...current, [side]: range } } };
    });
  }

  async function save() {
    if (!loaded || validation || busy) return;
    setSaving(true); setError("");
    try {
      const response = await updateCommentActionTiming(device.deviceCode, updatedAt, timing, platform);
      const resolved = timingDraft(response);
      setTiming(resolved); setBaseline(resolved); setSaved(response.timing); setUpdatedAt(response.updatedAt); setLastSaved(true);
      onSaved?.(response.timing, response.updatedAt, updatedAt);
      message.success("动作间隔已保存，等待设备配置刷新。");
    } catch (cause) { setError((cause as Error).message || "保存失败，请重试。"); }
    finally { setSaving(false); }
  }

  function close() {
    if (saving || copyOpen) return;
    if (!dirty) { onClose(); return; }
    modal.confirm({ title: "有尚未保存的动作间隔", content: "关闭后，这次输入的修改会丢弃。", okText: "放弃修改", cancelText: "继续编辑", onOk: onClose });
  }

  const intervalContent = <div className="cat-workspace">
    <nav className="cat-group-nav" aria-label="动作流程分组">
      {groups.map((group, index) => {
        const actions = COMMENT_ACTIONS.filter((action) => action.group === group);
        const changed = actions.filter(({ key }) => JSON.stringify(timing.actions[key]) !== JSON.stringify(deviceDefaults.actions[key])).length;
        return <button key={group} type="button" aria-pressed={activeGroup === group} onClick={() => setActiveGroup(group)}>
          <span className="cat-group-number">0{index + 1}</span><span className="cat-group-copy"><strong>{group}</strong>
            <small>{actions.length} 个动作{changed ? ` · ${changed} 项已调整` : ""}</small></span>
        </button>;
      })}
      <div className="cat-nav-note"><ClockCircleOutlined /><span>1000 ms = 1 秒<br />相同数值为固定等待</span></div>
    </nav>
    <div className="cat-editor" key={activeGroup}>
      <div className="cat-editor-heading"><div><h3>{activeGroup}</h3><p>{groupHints[groups.indexOf(activeGroup)]}</p></div><span>单位：毫秒</span></div>
      <div className="cat-howto">在最短与最长之间随机等待；两项相同则固定等待。精确到 1 毫秒。</div>
      <div className="cat-action-list">
        {COMMENT_ACTIONS.filter((action) => action.group === activeGroup).map(({ key, label, hint }) => {
          const value = timing.actions[key] || { beforeMs: [0, 0], afterMs: [0, 0] };
          return <div className="cat-row" key={key} role="group" aria-label={label}>
            <div className="cat-label"><strong>{label}</strong><span>{hint}</span></div>
            <div className="cat-pairs">
              <RangeInput label="动作前" value={value.beforeMs} disabled={!loaded || busy || !timing.enabled} onChange={(index, next) => changePair(key, "beforeMs", index, next)} />
              <RangeInput label="动作后" value={value.afterMs} disabled={!loaded || busy || !timing.enabled} onChange={(index, next) => changePair(key, "afterMs", index, next)} />
            </div>
          </div>;
        })}
      </div>
      <details className="cat-boundary"><summary>两步之间，实际等待多久？</summary>
        <p>上一步的“动作后” + 下一步的“动作前”。</p>
        <p>打开抖音 → 打开搜索入口：<b>{formatRange(adjacentWait(timing, "openDouyin", "openSearchEntry"))}</b>。</p>
        <p>这里设置额外等待，不包含点击、滑动和识别页面的耗时。</p>
      </details>
    </div>
  </div>;

  return <>
    <Modal className="cat-modal" open={open} onCancel={close} width={1020} footer={null}
      maskClosable={!saving && !copyOpen} closable={!saving && !copyOpen} keyboard={!saving && !copyOpen}
      title={<span className="cat-title"><ThunderboltOutlined /> 评论词动作控制</span>}>
      <div className="cat-hero"><div className="cat-device"><strong>{device.deviceName || device.deviceCode}</strong>
        <span>为这台设备设置抓取评论词的动作节奏</span></div>
        <div className="cat-switch"><Switch aria-label="使用自定义动作间隔" checked={timing.enabled} disabled={!loaded || busy}
          onChange={(enabled) => { setTiming((prior) => ({ ...prior, enabled })); setLastSaved(false); }} />
          <span>{timing.enabled ? "自定义间隔" : "系统默认间隔"}</span></div>
      </div>
      <div className={`cat-status${dirty ? " is-dirty" : ""}`} role="status">{lastSaved ? <CheckCircleOutlined /> : <span className="cat-status-dot" />}{status}</div>
      {!timing.enabled ? <Alert type="info" message="自定义间隔已停用。已填写的数值会保留，设备使用系统默认间隔。" /> : null}
      {error ? <Alert showIcon type="error" message={error} action={<Button size="small" disabled={busy} onClick={() => setLoadSequence((v) => v + 1)}>重新读取</Button>} /> : null}
      {validation ? <Alert showIcon type="error" message={validation} /> : null}
      <div className="cat-main"><Spin spinning={loading}><Tabs defaultActiveKey="interval" items={[
        { key: "interval", label: "动作间隔", children: intervalContent },
        { key: "path", label: <span className="cat-coming">动作路径<small>待开放</small></span>, disabled: true },
        { key: "range", label: <span className="cat-coming">动作范围<small>待开放</small></span>, disabled: true }
      ]} /></Spin></div>
      <div className="cat-foot"><div className="cat-foot-note"><span>设备收到配置后，从下一动作开始使用。</span>
        {needsSave || !timing.enabled ? <small>启用并保存完整配置后，即可复制到其他设备。</small> : <small>配置已就绪，可复制到其他设备。</small>}</div>
        <Space wrap>
          <Button type="text" icon={<ReloadOutlined />} disabled={!loaded || busy} onClick={() => { setTiming(timingDraft({ timing: deviceDefaults })); setLastSaved(false); }}>填入默认值</Button>
          <Button icon={<CopyOutlined />} onClick={() => setCopyOpen(true)} disabled={!loaded || busy || needsSave || !timing.enabled}>复制配置</Button>
          <Button type="primary" onClick={save} loading={saving} disabled={!loaded || loading || copyOpen || Boolean(validation) || !needsSave}>保存设置</Button>
        </Space>
      </div>
    </Modal>
    <CommentActionTimingCopyModal open={copyOpen && open} source={device} timing={timing} updatedAt={updatedAt} onClose={() => setCopyOpen(false)} />
  </>;
}
