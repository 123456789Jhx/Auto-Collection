export type BizScriptFileHash = { path: string; sha256: string };

export type BizScriptBaseline = {
  schemaVersion: 2;
  channel: "biz-scripts";
  version: string;
  apkBuildId: string;
  baseCompatibilityId: string;
  sourceSha256: string;
  files: BizScriptFileHash[];
  baseFiles: BizScriptFileHash[];
};

export const bizScriptUploadLimits = {
  maxFiles: 500,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxRequestBytes: 16 * 1024 * 1024
} as const;

export type BizScriptWorkspace = {
  ready: boolean;
  reason: string | null;
  baseline: BizScriptBaseline | null;
  limits: typeof bizScriptUploadLimits;
};

export type BizScriptPreviewInput = {
  baselineVersion: string;
  baseCompatibilityId: string;
  baseFiles: BizScriptFileHash[];
  files: Array<{ path: string; content: string }>;
  releaseNote?: string;
};

export type BizScriptStage = "DRAFT" | "TESTING" | "PROMOTED" | "REVOKED";

export type BizScriptPreview = {
  id: string;
  version: string;
  stage: BizScriptStage;
  revision: number;
  baselineVersion: string;
  apkBuildId: string;
  baseCompatibilityId: string;
  sourceSha256: string;
  packageSha256: string;
  sizeBytes: number;
  files: BizScriptFileHash[];
  changes: { added: string[]; modified: string[]; removed: string[] };
  releaseNote: string;
  createdAt: string;
  testDeviceIds: string[];
  deviceIds: string[];
};

export type BizScriptDevice = {
  deviceId: string;
  deviceCode: string;
  deviceName: string | null;
  enabled: boolean;
  lastHeartbeatAt: string | null;
  currentVersion: string | null;
  pendingVersion: string | null;
  source: "baseline" | "overlay" | null;
  baseCompatibilityId: string | null;
  sourceSha256: string | null;
  hotUpdateAllowed: boolean;
  fresh: boolean;
  targetVersion: string | null;
  state: "UNKNOWN" | "NEEDS_APK" | "OFFLINE" | "READY" | "PENDING" | "PENDING_RESTART" | "CURRENT" | "FAILED" | "REJECTED";
  eventMessage: string | null;
};

export type BizScriptScopeInput = { revision: number; deviceIds: string[] };
