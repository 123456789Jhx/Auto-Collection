// 设备画像表单模型。
// 字段与 mobile-agent/autojs/device-profiles.js 的 DEFAULT_VALUES / BUILT_IN_PROFILES
// 一一对应，改任意一侧都要同步另一侧。

import { commentActionTimingSchema, type CommentActionTiming } from "@pkg/types";

export type DeviceProfileCapture = {
  bringSelfToForeground?: boolean;
  foregroundWaitMs?: number;
  useWorkerThread?: boolean;
  timeoutMs?: number;
};

export type DeviceProfileOverride = {
  capture?: DeviceProfileCapture;
  openDouyinWaitMs?: [number, number];
  outputRoots?: string[];
  nodeQueryGraceMs?: number;
  commentActionTiming?: CommentActionTiming;
};

export type DeviceProfileValues = {
  capture: Required<DeviceProfileCapture>;
  openDouyinWaitMs: [number, number];
  outputRoots: string[];
  nodeQueryGraceMs: number;
  commentActionTiming?: CommentActionTiming;
};

export const DEFAULT_PROFILE_VALUES: DeviceProfileValues = {
  capture: {
    bringSelfToForeground: true,
    foregroundWaitMs: 800,
    useWorkerThread: true,
    timeoutMs: 120000
  },
  openDouyinWaitMs: [5000, 7000],
  outputRoots: [
    "/storage/emulated/0/燎原星火",
    "/sdcard/燎原星火",
    "/storage/emulated/0/Download/燎原星火",
    "/sdcard/Download/燎原星火",
    "/storage/emulated/0/AgriVideoCollector",
    "/sdcard/AgriVideoCollector"
  ],
  nodeQueryGraceMs: 0
};

export type BuiltInProfile = {
  key: string;
  label: string;
  models: string[];
  values: DeviceProfileOverride;
};

export const BUILT_IN_PROFILES: BuiltInProfile[] = [
  { key: "default", label: "未识别机型", models: [], values: {} },
  {
    key: "xiaomi_mi8",
    label: "小米 8",
    models: ["MI 8", "MI8", "M1803E1A", "M1803E1C", "M1803E1T"],
    values: {}
  },
  {
    key: "xiaomi_14",
    label: "小米 14",
    models: ["23127PN0CC", "23127PN0CG", "24129PN74C", "24129PN74G"],
    values: {
      capture: { foregroundWaitMs: 1200 },
      outputRoots: []
    }
  }
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function mergeProfileValues(
  base: DeviceProfileValues,
  override?: DeviceProfileOverride | null
): DeviceProfileValues {
  const result: DeviceProfileValues = {
    capture: { ...base.capture },
    openDouyinWaitMs: [base.openDouyinWaitMs[0], base.openDouyinWaitMs[1]],
    outputRoots: [...base.outputRoots],
    nodeQueryGraceMs: base.nodeQueryGraceMs,
    ...(base.commentActionTiming ? { commentActionTiming: commentActionTimingSchema.parse(base.commentActionTiming) } : {})
  };
  if (!override) return result;
  if (override.capture) {
    const target = result.capture as unknown as Record<string, unknown>;
    const source = override.capture as unknown as Record<string, unknown>;
    Object.keys(source).forEach((key) => {
      if (source[key] === undefined || source[key] === null) return;
      target[key] = source[key];
    });
  }
  if (override.openDouyinWaitMs) {
    result.openDouyinWaitMs = [override.openDouyinWaitMs[0], override.openDouyinWaitMs[1]];
  }
  if (override.outputRoots) result.outputRoots = [...override.outputRoots];
  if (typeof override.nodeQueryGraceMs === "number") result.nodeQueryGraceMs = override.nodeQueryGraceMs;
  if (override.commentActionTiming) result.commentActionTiming = commentActionTimingSchema.parse(override.commentActionTiming);
  return result;
}

export function resolveBuiltInValues(key: string): DeviceProfileValues {
  const profile = BUILT_IN_PROFILES.find((item) => item.key === key);
  return mergeProfileValues(DEFAULT_PROFILE_VALUES, profile ? profile.values : null);
}

/** 把后端返回的任意 JSON 收敛成可用覆盖；非法部分直接丢弃。 */
export function normalizeOverride(raw: unknown): DeviceProfileOverride | null {
  if (!isPlainObject(raw)) return null;
  const result: DeviceProfileOverride = {};
  if (isPlainObject(raw.capture)) {
    const capture: DeviceProfileCapture = {};
    const source = raw.capture as Record<string, unknown>;
    if (typeof source.bringSelfToForeground === "boolean") {
      capture.bringSelfToForeground = source.bringSelfToForeground;
    }
    if (typeof source.useWorkerThread === "boolean") capture.useWorkerThread = source.useWorkerThread;
    if (Number.isFinite(source.foregroundWaitMs as number)) {
      capture.foregroundWaitMs = Number(source.foregroundWaitMs);
    }
    if (Number.isFinite(source.timeoutMs as number)) capture.timeoutMs = Number(source.timeoutMs);
    if (Object.keys(capture).length > 0) result.capture = capture;
  }
  if (Array.isArray(raw.openDouyinWaitMs) && raw.openDouyinWaitMs.length >= 2) {
    const min = Number(raw.openDouyinWaitMs[0]);
    const max = Number(raw.openDouyinWaitMs[1]);
    if (Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min) {
      result.openDouyinWaitMs = [min, max];
    }
  }
  if (Array.isArray(raw.outputRoots)) {
    result.outputRoots = raw.outputRoots.filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );
  }
  if (Number.isFinite(raw.nodeQueryGraceMs as number)) {
    result.nodeQueryGraceMs = Number(raw.nodeQueryGraceMs);
  }
  const timing = commentActionTimingSchema.safeParse(raw.commentActionTiming);
  if (timing.success) result.commentActionTiming = timing.data;
  return Object.keys(result).length > 0 ? result : null;
}

/** 被覆盖的字段路径，用于 UI 高亮。 */
export function overriddenPaths(override: DeviceProfileOverride | null): string[] {
  if (!override) return [];
  const paths: string[] = [];
  if (override.capture) Object.keys(override.capture).forEach((key) => paths.push("capture." + key));
  if (override.openDouyinWaitMs) paths.push("openDouyinWaitMs");
  if (override.outputRoots) paths.push("outputRoots");
  if (typeof override.nodeQueryGraceMs === "number") paths.push("nodeQueryGraceMs");
  if (override.commentActionTiming) paths.push("commentActionTiming");
  return paths;
}

/** 内置画像相对默认值改了哪些字段，用于在卡片上展示差异。 */
export function builtInDiffKeys(profile: BuiltInProfile): string[] {
  return overriddenPaths(normalizeOverride(profile.values));
}
