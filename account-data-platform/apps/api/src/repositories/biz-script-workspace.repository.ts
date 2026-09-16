import { bizScriptArchives, bizScriptAudits, bizScriptPreviews } from "@pkg/db/biz-script-schema";
import { agentUpdateEvents, agentVersions, collectorDevices, deviceHeartbeats } from "@pkg/db/schema";
import type { BizScriptPreview, BizScriptStage } from "@pkg/types";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { config } from "../config";
import { compareBizScriptVersions, type BizScriptDeviceEvidence } from "../services/biz-script-device-state";
import { db } from "./db";

export type StoredBizScriptPreview = BizScriptPreview & { archiveBase64: string };
type PreviewRow = typeof bizScriptPreviews.$inferSelect;

export class BizScriptWorkspaceRepositoryError extends Error {
  constructor(readonly code: "VERSION_CONFLICT" | "REVISION_CONFLICT" | "NOT_FOUND" | "INVALID_TRANSITION" | "INVALID_ARCHIVE") {
    super(code);
  }
}

function toPreview(row: PreviewRow): BizScriptPreview {
  return {
    ...row.previewJson as BizScriptPreview, id: row.id, stage: row.stage as BizScriptStage,
    revision: row.revision, testDeviceIds: row.testDeviceIds, deviceIds: row.deviceIds
  };
}

export async function listPreviews(): Promise<BizScriptPreview[]> {
  const rows = await db.select().from(bizScriptPreviews)
    .where(eq(bizScriptPreviews.tenantId, config.tenantId))
    .orderBy(desc(bizScriptPreviews.createdAt));
  return rows.map(toPreview);
}

export async function listPreviousVersions(): Promise<string[]> {
  const rows = await db.select({ version: agentVersions.version }).from(agentVersions)
    .where(and(eq(agentVersions.tenantId, config.tenantId), eq(agentVersions.channel, "biz-scripts")));
  return rows.map((row) => row.version);
}

export async function getPreview(id: string): Promise<StoredBizScriptPreview | null> {
  const [row] = await db.select({ preview: bizScriptPreviews, archiveBase64: bizScriptArchives.archiveBase64 })
    .from(bizScriptPreviews)
    .innerJoin(bizScriptArchives, and(eq(bizScriptArchives.id, bizScriptPreviews.id), eq(bizScriptArchives.tenantId, config.tenantId)))
    .where(and(eq(bizScriptPreviews.id, id), eq(bizScriptPreviews.tenantId, config.tenantId))).limit(1);
  return row ? { ...toPreview(row.preview), archiveBase64: row.archiveBase64 } : null;
}

export async function savePreview(preview: StoredBizScriptPreview, actor: string): Promise<void> {
  if (preview.stage !== "DRAFT" || preview.revision !== 0 || preview.testDeviceIds.length || preview.deviceIds.length) {
    throw new BizScriptWorkspaceRepositoryError("INVALID_TRANSITION");
  }
  const { archiveBase64, ...metadata } = preview;
  if (archiveBase64.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) {
    throw new BizScriptWorkspaceRepositoryError("INVALID_ARCHIVE");
  }
  const archive = Buffer.from(archiveBase64, "base64");
  if (!archive.length || archive.length > 10 * 1024 * 1024 || archive.length !== preview.sizeBytes
    || archive.toString("base64") !== archiveBase64) throw new BizScriptWorkspaceRepositoryError("INVALID_ARCHIVE");
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${config.tenantId}), hashtext('biz-scripts'))`);
    const previous = await transaction.select({ version: agentVersions.version }).from(agentVersions)
      .where(and(eq(agentVersions.tenantId, config.tenantId), eq(agentVersions.channel, "biz-scripts")));
    if (!(compareBizScriptVersions(preview.version, preview.baselineVersion) > 0)
      || previous.some((row) => !(compareBizScriptVersions(preview.version, row.version) > 0))) {
      throw new BizScriptWorkspaceRepositoryError("VERSION_CONFLICT");
    }
    const createdAt = new Date(preview.createdAt);
    await transaction.insert(agentVersions).values({
      id: preview.id, tenantId: config.tenantId, version: preview.version, channel: "biz-scripts",
      packageUrl: `${config.publicBaseUrl.replace(/\/$/, "")}/downloads/biz-scripts/${preview.id}/${preview.packageSha256}.zip`,
      sha256: preview.packageSha256, entryFile: "biz-script-manifest.json", releaseNote: preview.releaseNote,
      forceUpdate: false, status: "DRAFT", publishedAt: createdAt, createdAt, createdBy: actor, updatedBy: actor
    });
    await transaction.insert(bizScriptPreviews).values({
      id: preview.id, tenantId: config.tenantId, previewJson: metadata, stage: "DRAFT", revision: 0,
      testDeviceIds: [], deviceIds: [], createdAt, createdBy: actor, updatedBy: actor
    });
    await transaction.insert(bizScriptArchives).values({ id: preview.id, tenantId: config.tenantId, archiveBase64 });
    await transaction.insert(bizScriptAudits).values({
      previewId: preview.id, tenantId: config.tenantId, stage: "DRAFT", revision: 0,
      testDeviceIds: [], deviceIds: [], actor
    });
  });
}

export async function transitionPreview(
  id: string, expectedRevision: number, stage: BizScriptStage, testDeviceIds: string[], deviceIds: string[], actor: string
): Promise<BizScriptPreview> {
  return db.transaction(async (transaction) => {
    const [existing] = await transaction.select().from(bizScriptPreviews)
      .where(and(eq(bizScriptPreviews.id, id), eq(bizScriptPreviews.tenantId, config.tenantId))).limit(1).for("update");
    if (!existing) throw new BizScriptWorkspaceRepositoryError("NOT_FOUND");
    if (existing.revision !== expectedRevision) throw new BizScriptWorkspaceRepositoryError("REVISION_CONFLICT");
    const allowed = (existing.stage === "DRAFT" && stage === "TESTING" && testDeviceIds.length > 0 && !deviceIds.length)
      || (existing.stage === "TESTING" && stage === "PROMOTED" && deviceIds.length > 0
        && JSON.stringify(existing.testDeviceIds) === JSON.stringify(testDeviceIds))
      || (existing.stage !== "REVOKED" && stage === "REVOKED"
        && JSON.stringify(existing.testDeviceIds) === JSON.stringify(testDeviceIds)
        && JSON.stringify(existing.deviceIds) === JSON.stringify(deviceIds));
    if (!allowed) throw new BizScriptWorkspaceRepositoryError("INVALID_TRANSITION");
    const revision = expectedRevision + 1;
    const updatedAt = new Date();
    const [updated] = await transaction.update(bizScriptPreviews).set({
      stage, revision, testDeviceIds, deviceIds, updatedAt, updatedBy: actor
    }).where(and(eq(bizScriptPreviews.id, id), eq(bizScriptPreviews.tenantId, config.tenantId),
      eq(bizScriptPreviews.revision, expectedRevision))).returning();
    if (!updated) throw new BizScriptWorkspaceRepositoryError("REVISION_CONFLICT");
    await transaction.update(agentVersions).set({
      status: stage === "REVOKED" ? "REVOKED" : "PUBLISHED", publishedAt: updatedAt, updatedAt, updatedBy: actor
    }).where(and(eq(agentVersions.id, id), eq(agentVersions.tenantId, config.tenantId), eq(agentVersions.channel, "biz-scripts")));
    await transaction.insert(bizScriptAudits).values({ previewId: id, tenantId: config.tenantId, stage, revision, testDeviceIds, deviceIds, actor });
    return toPreview(updated);
  });
}

export async function listBizScriptDeviceEvidence(deviceId?: string): Promise<BizScriptDeviceEvidence[]> {
  const devices = await db.select({
    deviceId: collectorDevices.id, deviceCode: collectorDevices.deviceCode,
    deviceName: collectorDevices.deviceName, enabled: collectorDevices.enabled
  }).from(collectorDevices).where(and(eq(collectorDevices.tenantId, config.tenantId),
    isNull(collectorDevices.deletedAt), deviceId ? eq(collectorDevices.id, deviceId) : undefined)).orderBy(asc(collectorDevices.deviceCode));
  const ids = devices.map((device) => device.deviceId);
  if (!ids.length) return [];
  const eventFields = {
    deviceId: agentUpdateEvents.deviceId, eventType: agentUpdateEvents.eventType, toVersion: agentUpdateEvents.toVersion,
    message: agentUpdateEvents.message, createdAt: agentUpdateEvents.createdAt, payloadJson: agentUpdateEvents.payloadJson
  };
  const eventConditions = [eq(agentUpdateEvents.tenantId, config.tenantId), isNull(agentUpdateEvents.deletedAt),
    inArray(agentUpdateEvents.deviceId, ids), sql`${agentUpdateEvents.payloadJson}->>'channel' = 'biz-scripts'`];
  const [heartbeats, events, failures] = await Promise.all([
    db.selectDistinctOn([deviceHeartbeats.deviceId], {
      deviceId: deviceHeartbeats.deviceId, heartbeatAt: deviceHeartbeats.createdAt, rawPayload: deviceHeartbeats.rawPayload
    }).from(deviceHeartbeats).where(and(eq(deviceHeartbeats.tenantId, config.tenantId), isNull(deviceHeartbeats.deletedAt),
      inArray(deviceHeartbeats.deviceId, ids))).orderBy(deviceHeartbeats.deviceId, desc(deviceHeartbeats.createdAt)),
    db.selectDistinctOn([agentUpdateEvents.deviceId], eventFields).from(agentUpdateEvents)
      .where(and(...eventConditions, ne(agentUpdateEvents.eventType, "CHECKED")))
      .orderBy(agentUpdateEvents.deviceId, desc(agentUpdateEvents.createdAt)),
    db.selectDistinctOn([agentUpdateEvents.deviceId], eventFields).from(agentUpdateEvents)
      .where(and(...eventConditions, inArray(agentUpdateEvents.eventType, ["FAILED", "ROLLBACK"])))
      .orderBy(agentUpdateEvents.deviceId, desc(agentUpdateEvents.createdAt))
  ]);
  const heartbeatMap = new Map(heartbeats.map((row) => [row.deviceId, row]));
  const eventMap = new Map(events.map((row) => [row.deviceId, row]));
  const failureMap = new Map(failures.map((row) => [row.deviceId, row]));
  return devices.map((device) => ({
    ...device, heartbeatAt: heartbeatMap.get(device.deviceId)?.heartbeatAt ?? null,
    rawPayload: heartbeatMap.get(device.deviceId)?.rawPayload ?? null,
    latestEvent: eventMap.get(device.deviceId) ?? null, latestFailure: failureMap.get(device.deviceId) ?? null
  }));
}
