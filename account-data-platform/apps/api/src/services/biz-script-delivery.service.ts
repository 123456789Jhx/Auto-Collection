import type { BizScriptDevice, BizScriptPreview } from "@pkg/types";
import { config } from "../config";
import { listBizScriptDeviceEvidence, listPreviews } from "../repositories/biz-script-workspace.repository";
import { compareBizScriptVersions, deriveBizScriptDevice } from "./biz-script-device-state";

export function selectScopedBizScriptPreview(
  previews: BizScriptPreview[], device: BizScriptDevice, currentVersion?: string
): BizScriptPreview | null {
  if (!device.enabled || !device.fresh || !device.hotUpdateAllowed) return null;
  const eligible = previews.filter((preview) => {
    const scope = preview.stage === "TESTING" ? preview.testDeviceIds
      : preview.stage === "PROMOTED" ? [...preview.testDeviceIds, ...preview.deviceIds] : [];
    if (!scope.includes(device.deviceId) || preview.baseCompatibilityId !== device.baseCompatibilityId) return false;
    if (currentVersion !== undefined) {
      if (!(compareBizScriptVersions(preview.version, currentVersion) > 0)) return false;
      if (!device.currentVersion || !(compareBizScriptVersions(preview.version, device.currentVersion) > 0)) return false;
    }
    return true;
  });
  eligible.sort((a, b) => compareBizScriptVersions(b.version, a.version));
  return eligible[0] ?? null;
}

export async function listBizScriptDevices(): Promise<BizScriptDevice[]> {
  const [evidence, previews] = await Promise.all([listBizScriptDeviceEvidence(), listPreviews()]);
  const now = new Date();
  return evidence.map((row) => {
    const device = deriveBizScriptDevice(row, null, previews, now);
    const target = selectScopedBizScriptPreview(previews, device);
    return deriveBizScriptDevice(row, target, previews, now);
  });
}

export async function findScopedBizScriptVersion(deviceId: string, currentVersion: string) {
  const [evidence, previews] = await Promise.all([listBizScriptDeviceEvidence(deviceId), listPreviews()]);
  const row = evidence.find((item) => item.deviceId === deviceId);
  if (!row) return null;
  const device = deriveBizScriptDevice(row, null, previews);
  const preview = selectScopedBizScriptPreview(previews, device, currentVersion);
  if (!preview) return null;
  const runtime = row.rawPayload?.bizScriptRuntime as Record<string, unknown> | undefined;
  if (typeof runtime?.baselineVersion !== "string"
    || !(compareBizScriptVersions(preview.version, runtime.baselineVersion) > 0)) return null;
  return {
    id: preview.id, version: preview.version, channel: "biz-scripts", minSupportedVersion: null,
    packageUrl: `${config.publicBaseUrl.replace(/\/$/, "")}/downloads/biz-scripts/${preview.id}/${preview.packageSha256}.zip`,
    sha256: preview.packageSha256, entryFile: "biz-script-manifest.json", releaseNote: preview.releaseNote,
    publishedAt: new Date(preview.createdAt), forceUpdate: false
  };
}
