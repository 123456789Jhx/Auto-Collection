import { useEffect, useMemo, useRef, useState } from "react";
import type { CommentActionTiming } from "@pkg/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntdApp,
  Button,
  Divider,
  Empty,
  Input,
  InputNumber,
  Modal,
  Slider,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography
} from "antd";
import { ClearOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { getDeviceTaskConfig } from "../../lib/api-client";
import { updateDeviceProfile } from "../../lib/api-client-comment-action-timing";
import { acceptSavedTiming } from "../../lib/device-profile-revision";
import {
  BUILT_IN_PROFILES,
  builtInDiffKeys,
  mergeProfileValues,
  normalizeOverride,
  overriddenPaths,
  resolveBuiltInValues,
  type DeviceProfileCapture,
  type DeviceProfileOverride
} from "../../lib/device-profile-form";
import "./device-profile.css";
import { CommentActionTimingPanel } from "./CommentActionTimingPanel";

const { Paragraph } = Typography;

function formatSeconds(milliseconds: number) {
  const seconds = Number(milliseconds || 0) / 1000;
  if (!Number.isFinite(seconds)) return "0 秒";
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`;
}

function toMilliseconds(seconds: number, fallback: number) {
  const value = Number(seconds);
  return Number.isFinite(value) ? Math.round(value * 1000) : fallback;
}

const friendlyDiffLabels: Record<string, string> = {
  "capture.foregroundWaitMs": "前台等待",
  "capture.timeoutMs": "授权等待",
  "capture.bringSelfToForeground": "自动回到前台",
  "capture.useWorkerThread": "稳定授权模式",
  openDouyinWaitMs: "抖音启动等待",
  outputRoots: "保存位置",
  nodeQueryGraceMs: "识别等待"
};

export type DeviceProfileTarget = {
  deviceCode: string;
  deviceName?: string;
  platform?: string;
};

type Props = {
  open: boolean;
  device?: DeviceProfileTarget | null;
  onClose: () => void;
};

export function DeviceProfileModal({ open, device, onClose }: Props) {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const deviceCode = device?.deviceCode || "";
  const platform = device?.platform || "douyin";

  const configQuery = useQuery({
    queryKey: ["device-task-config", deviceCode, platform],
    enabled: open && !!deviceCode,
    queryFn: () => getDeviceTaskConfig(deviceCode, platform),
    refetchOnWindowFocus: false
  });

  const savedOverride = useMemo(
    () => normalizeOverride((configQuery.data as Record<string, unknown> | undefined)?.deviceProfile),
    [configQuery.data]
  );

  const [draft, setDraft] = useState<DeviceProfileOverride>({});
  const [baseKey, setBaseKey] = useState("default");
  const [rootInput, setRootInput] = useState("");
  const [timingOpen, setTimingOpen] = useState(false);
  const [profileConflict, setProfileConflict] = useState(false);
  const childTiming = useRef<CommentActionTiming | null | undefined>(undefined);
  const childRevision = useRef<string | null | undefined>(undefined);

  useEffect(() => { childTiming.current = undefined; childRevision.current = undefined; setTimingOpen(false); setProfileConflict(false); }, [open, deviceCode]);

  useEffect(() => {
    if (!open) return;
    const next = { ...(savedOverride ?? {}) };
    if (childTiming.current !== undefined) {
      if (childTiming.current) next.commentActionTiming = childTiming.current;
      else delete next.commentActionTiming;
    }
    setDraft(next);
    setRootInput("");
  }, [open, savedOverride]);

  const baseValues = useMemo(() => resolveBuiltInValues(baseKey), [baseKey]);
  const preview = useMemo(() => mergeProfileValues(baseValues, draft), [baseValues, draft]);
  const paths = useMemo(() => overriddenPaths(normalizeOverride(draft)), [draft]);
  const isOverridden = (path: string) => paths.indexOf(path) >= 0;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["device-task-config", deviceCode, platform] });
    void queryClient.invalidateQueries({ queryKey: ["devices"] });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (profileConflict) throw new Error("设备其他配置已被修改，请关闭并重新打开设备画像后再保存。");
      const current = { ...draft };
      if (childTiming.current !== undefined) {
        if (childTiming.current) current.commentActionTiming = childTiming.current;
        else delete current.commentActionTiming;
      }
      const revision = childRevision.current !== undefined ? childRevision.current : typeof configQuery.data?.updatedAt === "string" ? configQuery.data.updatedAt : null;
      return updateDeviceProfile(deviceCode, normalizeOverride(current) ?? null, revision, platform);
    },
    onSuccess: () => {
      message.success("设备画像已保存，设置已同步到手机");
      invalidate();
      onClose();
    },
    onError: (error: Error) => message.error(error.message || "保存失败")
  });

  const clearMutation = useMutation({
    mutationFn: () => updateDeviceProfile(deviceCode, null, childRevision.current !== undefined ? childRevision.current : typeof configQuery.data?.updatedAt === "string" ? configQuery.data.updatedAt : null, platform),
    onSuccess: (response) => {
      message.success("已恢复默认设置，设备将使用内置方案");
      setDraft({});
      childTiming.current = null;
      childRevision.current = typeof response.updatedAt === "string" ? response.updatedAt : undefined;
      invalidate();
    },
    onError: (error: Error) => message.error(error.message || "清除失败")
  });

  function patchCapture(key: keyof DeviceProfileCapture, value: boolean | number) {
    setDraft((prev) => {
      const capture: DeviceProfileCapture = { ...(prev.capture || {}) };
      if (key === "bringSelfToForeground" || key === "useWorkerThread") {
        capture[key] = Boolean(value);
      } else {
        capture[key] = Number(value);
      }
      return { ...prev, capture };
    });
  }

  function dropCaptureKey(key: string) {
    setDraft((prev) => {
      const next = { ...(prev.capture || {}) } as Record<string, unknown>;
      delete next[key];
      return { ...prev, capture: next as DeviceProfileOverride["capture"] };
    });
  }

  const effectiveRoots = draft.outputRoots ?? baseValues.outputRoots;
  const rootsOverridden = Array.isArray(draft.outputRoots);

  function addRoot() {
    const value = rootInput.trim();
    if (!value || effectiveRoots.indexOf(value) >= 0) return;
    setDraft((prev) => ({ ...prev, outputRoots: [...effectiveRoots, value] }));
    setRootInput("");
  }

  function removeRoot(value: string) {
    setDraft((prev) => ({ ...prev, outputRoots: effectiveRoots.filter((item) => item !== value) }));
  }

  if (!device) return null;

  return (
    <>
    <Modal
      className="dp-modal"
      wrapClassName="dp-modal-wrap"
      open={open}
      onCancel={onClose}
      width={820}
      footer={null}
      title={
        <div className="dp-modal-title">
          <span className="dp-modal-title-icon"><ThunderboltOutlined /></span>
          <span className="dp-modal-title-copy">
            <strong>设备画像</strong>
            <small>{device.deviceName || device.deviceCode}</small>
          </span>
          {savedOverride ? <Tag color="orange">已自定义</Tag> : <Tag color="default">使用默认方案</Tag>}
          <Button size="small" onClick={() => setTimingOpen(true)}>评论词动作间隔</Button>
        </div>
      }
    >
      {configQuery.isError ? (
        <Alert type="error" showIcon message="配置读取失败" description={String((configQuery.error as Error)?.message || "")} />
      ) : null}

      <div className="dp-hero">
        <div className="dp-hero-copy">
          <span className="dp-hero-kicker">设备概览</span>
          <strong>{device.deviceName || "未命名设备"}</strong>
          <span className="dp-hero-code">{device.deviceCode}</span>
        </div>
        <div className="dp-hero-state">
          <span className="dp-state-orbit" />
          <span>当前使用</span>
          <strong>{savedOverride ? "自定义方案" : "内置方案"}</strong>
        </div>
      </div>

      <div className="dp-friendly-note">
        <span className="dp-friendly-note-mark">i</span>
        <span>系统会自动选择适合这台设备的方案。通常只需选择机型，其他设置保持默认即可。</span>
      </div>

      <div className="dp-section" style={{ marginBottom: 16 }}>
        <div className="dp-section-title"><span>选择设备类型</span><small>点击卡片查看适配效果</small></div>
        <div className="dp-cards">
          {BUILT_IN_PROFILES.map((profile) => {
            const active = baseKey === profile.key;
            const diffs = builtInDiffKeys(profile);
            return (
              <div
                key={profile.key}
                className={"dp-card" + (active ? " dp-card--active" : "")}
                onClick={() => setBaseKey(profile.key)}
              >
                <div className="dp-card-title">
                  <span>{profile.label}</span>
                  {active ? <Tag color="blue">预览基准</Tag> : null}
                </div>
                <div className="dp-card-models">
                  {profile.models.length ? `适配 ${profile.label} 系列` : "通用方案"}
                </div>
                <div className="dp-card-diff">
                  {diffs.length ? (
                    diffs.map((key) => (
                      <Tag key={key} color="gold" className="dp-chip-enter">
                        {friendlyDiffLabels[key] || key}
                      </Tag>
                    ))
                  ) : (
                    <Tag className="dp-chip-enter">与默认值一致</Tag>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Divider style={{ margin: "14px 0" }} />

      <div className="dp-section" style={{ marginBottom: 16 }}>
        <div className="dp-section-title"><span>截图授权</span><small>首次运行时需要确认</small></div>

        <div className={"dp-row" + (isOverridden("capture.bringSelfToForeground") ? " dp-row--overridden" : "")}>
          <div className="dp-row-label">
            <span>申请前自动回到前台</span>
            <span className="dp-row-desc">让授权弹窗可以正常点击</span>
          </div>
          <Space>
            <Switch
              checked={preview.capture.bringSelfToForeground}
              onChange={(value) => patchCapture("bringSelfToForeground", value)}
            />
            {isOverridden("capture.bringSelfToForeground") ? (
              <Tooltip title="恢复为内置值">
                <Button size="small" icon={<ReloadOutlined />} onClick={() => dropCaptureKey("bringSelfToForeground")} />
              </Tooltip>
            ) : null}
          </Space>
        </div>

        <div className={"dp-row" + (isOverridden("capture.foregroundWaitMs") ? " dp-row--overridden" : "")}>
          <div className="dp-row-label">
            <span>回到前台后等待</span>
            <span className="dp-row-desc">内置 {formatSeconds(baseValues.capture.foregroundWaitMs)}</span>
          </div>
          <Space>
            <InputNumber
              min={0}
              max={60}
              step={0.1}
              precision={1}
              value={Number((preview.capture.foregroundWaitMs / 1000).toFixed(1))}
              onChange={(value) => patchCapture("foregroundWaitMs", toMilliseconds(Number(value ?? 0), 0))}
              addonAfter="秒"
              style={{ width: 150 }}
            />
            {isOverridden("capture.foregroundWaitMs") ? (
              <Button size="small" icon={<ReloadOutlined />} onClick={() => dropCaptureKey("foregroundWaitMs")} />
            ) : null}
          </Space>
        </div>

        <div className={"dp-row" + (isOverridden("capture.useWorkerThread") ? " dp-row--overridden" : "")}>
          <div className="dp-row-label">
            <span>使用稳定授权模式</span>
            <span className="dp-row-desc">减少授权弹窗无响应的情况</span>
          </div>
          <Space>
            <Switch
              checked={preview.capture.useWorkerThread}
              onChange={(value) => patchCapture("useWorkerThread", value)}
            />
            {isOverridden("capture.useWorkerThread") ? (
              <Button size="small" icon={<ReloadOutlined />} onClick={() => dropCaptureKey("useWorkerThread")} />
            ) : null}
          </Space>
        </div>

        <div className={"dp-row" + (isOverridden("capture.timeoutMs") ? " dp-row--overridden" : "")}>
          <div className="dp-row-label">
            <span>等待你确认的最长时间</span>
            <span className="dp-row-desc">内置 {formatSeconds(baseValues.capture.timeoutMs)}</span>
          </div>
          <Space>
            <InputNumber
              min={1}
              max={600}
              step={1}
              value={Math.round(preview.capture.timeoutMs / 1000)}
              onChange={(value) => patchCapture("timeoutMs", toMilliseconds(Number(value ?? 120), 120000))}
              addonAfter="秒"
              style={{ width: 170 }}
            />
            {isOverridden("capture.timeoutMs") ? (
              <Button size="small" icon={<ReloadOutlined />} onClick={() => dropCaptureKey("timeoutMs")} />
            ) : null}
          </Space>
        </div>
      </div>

      <div className="dp-section" style={{ marginBottom: 16 }}>
        <div className="dp-section-title"><span>启动与保存</span><small>影响首次打开和文件保存位置</small></div>

        <div className={"dp-row" + (isOverridden("openDouyinWaitMs") ? " dp-row--overridden" : "")} style={{ display: "block" }}>
          <div className="dp-row-label" style={{ marginBottom: 8 }}>
            <span>打开抖音后等待</span>
            <span className="dp-row-desc">
              当前 {formatSeconds(preview.openDouyinWaitMs[0])} ~ {formatSeconds(preview.openDouyinWaitMs[1])}
              {isOverridden("openDouyinWaitMs") ? "（已自定义）" : `（内置 ${formatSeconds(baseValues.openDouyinWaitMs[0])} ~ ${formatSeconds(baseValues.openDouyinWaitMs[1])}）`}
            </span>
          </div>
          <Slider
            range
            min={0}
            max={30000}
            step={100}
            value={[preview.openDouyinWaitMs[0], preview.openDouyinWaitMs[1]]}
            onChange={(value) => {
              const pair = value as number[];
              setDraft((prev) => ({ ...prev, openDouyinWaitMs: [Number(pair[0]), Number(pair[1])] }));
            }}
          />
          {isOverridden("openDouyinWaitMs") ? (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() =>
                setDraft((prev) => {
                  const next = { ...prev };
                  delete next.openDouyinWaitMs;
                  return next;
                })
              }
            >
              恢复内置区间
            </Button>
          ) : null}
        </div>

        <div className={"dp-row" + (rootsOverridden ? " dp-row--overridden" : "")} style={{ display: "block" }}>
          <div className="dp-row-label" style={{ marginBottom: 8 }}>
            <span>保存位置</span>
            <span className="dp-row-desc">
              {effectiveRoots.length ? `将按顺序尝试 ${effectiveRoots.length} 个位置${rootsOverridden ? "（已自定义）" : "（内置）"}` : "未设置时自动使用应用目录"}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {effectiveRoots.length ? (
              effectiveRoots.map((root) => (
                <Tag
                  key={root}
                  closable
                  color={rootsOverridden ? "gold" : "default"}
                  onClose={() => removeRoot(root)}
                  className="dp-chip-enter"
                >
                  {root}
                </Tag>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未配置候选目录" style={{ margin: 0 }} />
            )}
          </div>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="/storage/emulated/0/燎原星火"
              value={rootInput}
              onChange={(event) => setRootInput(event.target.value)}
              onPressEnter={addRoot}
            />
            <Button icon={<PlusOutlined />} onClick={addRoot}>
              添加
            </Button>
          </Space.Compact>
        </div>

        <div className={"dp-row" + (isOverridden("nodeQueryGraceMs") ? " dp-row--overridden" : "")}>
          <div className="dp-row-label">
            <span>识别页面时的额外等待</span>
            <span className="dp-row-desc">设备较慢时可调大，内置 {formatSeconds(baseValues.nodeQueryGraceMs)}</span>
          </div>
          <Space>
            <InputNumber
              min={0}
              max={60}
              step={0.1}
              precision={1}
              value={Number((preview.nodeQueryGraceMs / 1000).toFixed(1))}
              onChange={(value) => setDraft((prev) => ({ ...prev, nodeQueryGraceMs: toMilliseconds(Number(value ?? 0), 0) }))}
              addonAfter="秒"
              style={{ width: 150 }}
            />
            {isOverridden("nodeQueryGraceMs") ? (
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() =>
                  setDraft((prev) => {
                    const next = { ...prev };
                    delete next.nodeQueryGraceMs;
                    return next;
                  })
                }
              />
            ) : null}
          </Space>
        </div>
      </div>

      <details className="dp-advanced">
        <summary>
          <span className="dp-advanced-title">高级配置</span>
          <span className="dp-advanced-hint">需要精细调试时再展开</span>
        </summary>
        <div className="dp-advanced-body">
          <div className="dp-section">
            <div className="dp-section-title">生效预览（基准：{paths.length ? "已合并" : "未覆盖"}）</div>
            <div className="dp-preview">
          <div>
            <span className={isOverridden("capture.bringSelfToForeground") ? "dp-preview-key--overridden" : ""}>
              capture.bringSelfToForeground
            </span>
            {" = "}
            {String(preview.capture.bringSelfToForeground)}
          </div>
          <div>
            <span className={isOverridden("capture.foregroundWaitMs") ? "dp-preview-key--overridden" : ""}>
              capture.foregroundWaitMs
            </span>
            {" = "}
            {preview.capture.foregroundWaitMs}
          </div>
          <div>
            <span className={isOverridden("capture.useWorkerThread") ? "dp-preview-key--overridden" : ""}>
              capture.useWorkerThread
            </span>
            {" = "}
            {String(preview.capture.useWorkerThread)}
          </div>
          <div>
            <span className={isOverridden("capture.timeoutMs") ? "dp-preview-key--overridden" : ""}>capture.timeoutMs</span>
            {" = "}
            {preview.capture.timeoutMs}
          </div>
          <div>
            <span className={isOverridden("openDouyinWaitMs") ? "dp-preview-key--overridden" : ""}>openDouyinWaitMs</span>
            {" = ["}
            {preview.openDouyinWaitMs.join(", ")}
            {"]"}
          </div>
          <div>
            <span className={rootsOverridden ? "dp-preview-key--overridden" : ""}>outputRoots</span>
            {" = ["}
            {preview.outputRoots.join(", ") || "（空，写脚本目录）"}
            {"]"}
          </div>
          <div>
            <span className={isOverridden("nodeQueryGraceMs") ? "dp-preview-key--overridden" : ""}>
              nodeQueryGraceMs
            </span>
            {" = "}
            {preview.nodeQueryGraceMs}
          </div>
            </div>
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              黄色字段为本次会写入服务端的覆盖项，其余字段手机端会继承内置画像。
            </Paragraph>
          </div>
        </div>
      </details>

      <Divider style={{ margin: "14px 0" }} />

      {profileConflict ? <Alert type="warning" showIcon message="动作间隔已保存；设备的其他配置已被另一个页面修改。请关闭并重新打开设备画像，再编辑其他设置。" /> : null}
      <Space className="dp-modal-footer" style={{ display: "flex", justifyContent: "space-between" }}>
        <Button
          danger
          icon={<ClearOutlined />}
          loading={clearMutation.isPending}
          disabled={!savedOverride || profileConflict || saveMutation.isPending || configQuery.isFetching}
          onClick={() => clearMutation.mutate()}
        >
          恢复默认设置
        </Button>
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saveMutation.isPending}
            disabled={profileConflict || clearMutation.isPending || configQuery.isFetching || configQuery.isError}
            onClick={() => saveMutation.mutate()}
          >
            保存并应用
          </Button>
        </Space>
      </Space>
    </Modal>
    <CommentActionTimingPanel open={timingOpen} device={device} onClose={() => setTimingOpen(false)} onSaved={(timing, revision, previousRevision) => {
      const parentRevision = childRevision.current !== undefined ? childRevision.current : typeof configQuery.data?.updatedAt === "string" ? configQuery.data.updatedAt : null;
      const merged = acceptSavedTiming(draft, parentRevision, timing, revision, previousRevision);
      childTiming.current = timing;
      childRevision.current = merged.revision;
      setDraft(merged.draft);
      setProfileConflict(merged.conflict);
      void queryClient.invalidateQueries({ queryKey: ["device-task-config", deviceCode, platform], refetchType: "none" });
    }} />
    </>
  );
}
