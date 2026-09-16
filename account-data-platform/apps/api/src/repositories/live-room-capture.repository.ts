import { liveRoomCaptures, liveRoomProfiles } from "@pkg/db/schema";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export type LiveRoomComment = Record<string, unknown>;
const PROFILE_TIMEOUT_MS = 5 * 60 * 1000;

export async function upsertLiveRoomCapture(input: {
  batchId: string;
  deviceId: string;
  commandId: string;
  roomKey: string;
  comments: LiveRoomComment[];
  result: Record<string, unknown>;
}) {
  const completed = input.result.captureCompleted === true || [
    "LIVE_COMMENT_ENTRY_CAPTURED",
    "LIVE_COMMENT_ENTRY_STOPPED"
  ].includes(String(input.result.status || input.result.captureStatus));
  const first = input.comments[0] ?? {};
  const [row] = await db.insert(liveRoomCaptures).values({
    tenantId: config.tenantId,
    batchId: input.batchId,
    deviceId: input.deviceId,
    commandId: input.commandId,
    roomKey: input.roomKey,
    accountId: stringValue(first.accountId),
    accountName: stringValue(first.accountName),
    roomName: stringValue(first.roomName),
    viewerCount: numberValue(first.viewerCount) ?? numberValue(input.result.viewerCount),
    captureStatus: stringValue(input.result.captureStatus) || stringValue(input.result.status) || "CAPTURED",
    captureCompleted: completed,
    capturedAt: new Date(),
    completedAt: completed ? new Date() : null,
    rawComments: input.comments,
    updatedAt: new Date(),
    updatedBy: "mobile_agent"
  }).onConflictDoUpdate({
    target: [liveRoomCaptures.tenantId, liveRoomCaptures.batchId, liveRoomCaptures.deviceId, liveRoomCaptures.roomKey],
    set: {
      commandId: input.commandId,
      accountId: stringValue(first.accountId),
      accountName: stringValue(first.accountName),
      roomName: stringValue(first.roomName),
      viewerCount: numberValue(first.viewerCount) ?? numberValue(input.result.viewerCount),
      captureStatus: stringValue(input.result.captureStatus) || stringValue(input.result.status) || "CAPTURED",
      captureCompleted: completed,
      completedAt: completed ? new Date() : null,
      rawComments: input.comments,
      updatedAt: new Date(),
      updatedBy: "mobile_agent"
    }
  }).returning();
  return row;
}

export async function listLiveRoomCaptures(batchId: string, deviceId: string) {
  return db.select().from(liveRoomCaptures).where(and(
    eq(liveRoomCaptures.tenantId, config.tenantId),
    eq(liveRoomCaptures.batchId, batchId),
    eq(liveRoomCaptures.deviceId, deviceId),
    isNull(liveRoomCaptures.deletedAt)
  )).orderBy(desc(liveRoomCaptures.updatedAt));
}

export async function findLiveRoomCapture(captureId: string) {
  const [row] = await db.select().from(liveRoomCaptures).where(and(
    eq(liveRoomCaptures.tenantId, config.tenantId),
    eq(liveRoomCaptures.id, captureId),
    isNull(liveRoomCaptures.deletedAt)
  )).limit(1);
  return row ?? null;
}

export async function findLiveRoomProfile(captureId: string) {
  await db.update(liveRoomProfiles).set({
    status: "FAILED",
    errorMessage: "画像解析超时或服务已重启，请重新解析。",
    updatedAt: nextProfileUpdatedAt(),
    updatedBy: "system"
  }).where(and(
    eq(liveRoomProfiles.tenantId, config.tenantId),
    eq(liveRoomProfiles.captureId, captureId),
    isNull(liveRoomProfiles.deletedAt),
    inArray(liveRoomProfiles.status, ["PENDING", "RUNNING"]),
    lt(liveRoomProfiles.updatedAt, new Date(Date.now() - PROFILE_TIMEOUT_MS))
  ));
  const [row] = await db.select().from(liveRoomProfiles).where(and(
    eq(liveRoomProfiles.tenantId, config.tenantId),
    eq(liveRoomProfiles.captureId, captureId),
    isNull(liveRoomProfiles.deletedAt)
  )).limit(1);
  return row ?? null;
}

export async function createLiveRoomProfile(input: {
  captureId: string;
  status: string;
  provider?: string;
  model?: string;
}) {
  const [row] = await db.insert(liveRoomProfiles).values({
    tenantId: config.tenantId,
    captureId: input.captureId,
    status: input.status,
    provider: input.provider,
    model: input.model,
    updatedAt: new Date(),
    createdBy: "admin",
    updatedBy: "admin"
  }).onConflictDoUpdate({
    target: [liveRoomProfiles.tenantId, liveRoomProfiles.captureId],
    set: {
      status: input.status,
      provider: input.provider,
      model: input.model,
      errorMessage: null,
      completedAt: null,
      updatedAt: nextProfileUpdatedAt(),
      updatedBy: "admin"
    },
    setWhere: and(
      eq(liveRoomProfiles.status, "FAILED"),
      isNull(liveRoomProfiles.deletedAt)
    )
  }).returning();
  return row;
}

export async function updateLiveRoomProfile(
  captureId: string,
  values: Partial<typeof liveRoomProfiles["$inferInsert"]>,
  expectedUpdatedAt?: Date
) {
  const [row] = await db.update(liveRoomProfiles).set({ ...values, updatedAt: nextProfileUpdatedAt() }).where(and(
    eq(liveRoomProfiles.tenantId, config.tenantId),
    eq(liveRoomProfiles.captureId, captureId),
    isNull(liveRoomProfiles.deletedAt),
    expectedUpdatedAt ? eq(liveRoomProfiles.updatedAt, expectedUpdatedAt) : undefined
  )).returning();
  return row ?? null;
}

function nextProfileUpdatedAt() {
  // A millisecond-aligned, increasing timestamp also serves as the request ownership token.
  return sql`greatest(${new Date().toISOString()}::timestamptz,
    date_trunc('milliseconds', ${liveRoomProfiles.updatedAt}) + interval '1 millisecond')`;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : null;
}
