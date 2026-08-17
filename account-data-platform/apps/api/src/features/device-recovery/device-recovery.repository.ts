import { deviceRecoverySessions, deviceRecoveryStageEvents } from "@pkg/db/schema";
import type {
  DeviceRecoveryResultStatus,
  DeviceRecoverySource,
  DeviceRecoveryStage
} from "@pkg/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { config } from "../../config";
import { db } from "../../repositories/db";

export type RecoveryDevice = { id: string; deviceCode: string };

export type DeviceRecoverySessionRecord = {
  sessionId: string;
  devicePk: string;
  deviceId: string;
  commandId?: string;
  bootId?: string;
  source: DeviceRecoverySource;
  channel?: "AGENT_POLL" | "XIAOMI_PUSH";
  stage: DeviceRecoveryStage;
  resultStatus?: DeviceRecoveryResultStatus;
  errorCode?: string;
  errorMessage?: string;
  startedAt: Date;
  lastStageAt: Date;
  updatedAt: Date;
  completedAt?: Date;
};

export type DeviceRecoveryEventRecord = {
  eventId: string;
  sessionId: string;
  devicePk: string;
  eventKey: string;
  stage: DeviceRecoveryStage;
  occurredAt: Date;
  reportedAt: Date;
  details?: Record<string, unknown>;
};

export type DeviceRecoveryRepository = {
  findDeviceByCode(deviceCode: string): Promise<RecoveryDevice | null>;
  findSessionById(sessionId: string, devicePk: string): Promise<DeviceRecoverySessionRecord | null>;
  findSessionByBoot(devicePk: string, bootId: string): Promise<DeviceRecoverySessionRecord | null>;
  findSessionByCommand(devicePk: string, commandId: string): Promise<DeviceRecoverySessionRecord | null>;
  findSessionByCommandId(commandId: string): Promise<DeviceRecoverySessionRecord | null>;
  createSession(input: Omit<DeviceRecoverySessionRecord, "sessionId" | "updatedAt">): Promise<DeviceRecoverySessionRecord>;
  findEventByKey(devicePk: string, eventKey: string): Promise<DeviceRecoveryEventRecord | null>;
  appendEvent(input: Omit<DeviceRecoveryEventRecord, "eventId">): Promise<{ event: DeviceRecoveryEventRecord; created: boolean }>;
  updateSession(sessionId: string, patch: Partial<Pick<DeviceRecoverySessionRecord,
    "stage" | "lastStageAt" | "resultStatus" | "errorCode" | "errorMessage" | "completedAt" | "updatedAt"
  >>): Promise<DeviceRecoverySessionRecord>;
  findLatestSession(devicePk: string): Promise<DeviceRecoverySessionRecord | null>;
  listEvents(sessionId: string): Promise<DeviceRecoveryEventRecord[]>;
};

function cloneSession(record: DeviceRecoverySessionRecord) {
  return { ...record };
}

function cloneEvent(record: DeviceRecoveryEventRecord) {
  return { ...record, details: record.details ? { ...record.details } : undefined };
}

export function createInMemoryDeviceRecoveryRepository(devices: RecoveryDevice[] = []): DeviceRecoveryRepository & {
  listSessions(): DeviceRecoverySessionRecord[];
  allEvents(): DeviceRecoveryEventRecord[];
} {
  const deviceRecords = new Map(devices.map((device) => [device.deviceCode, { ...device }]));
  const sessions = new Map<string, DeviceRecoverySessionRecord>();
  const events = new Map<string, DeviceRecoveryEventRecord>();
  let nextId = 1;
  const id = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

  return {
    async findDeviceByCode(deviceCode) {
      return deviceRecords.get(deviceCode) ?? null;
    },
    async findSessionById(sessionId, devicePk) {
      const record = sessions.get(sessionId);
      return record?.devicePk === devicePk ? cloneSession(record) : null;
    },
    async findSessionByBoot(devicePk, bootId) {
      const record = Array.from(sessions.values()).find((item) => item.devicePk === devicePk && item.bootId === bootId);
      return record ? cloneSession(record) : null;
    },
    async findSessionByCommand(devicePk, commandId) {
      const record = Array.from(sessions.values()).find((item) => item.devicePk === devicePk && item.commandId === commandId);
      return record ? cloneSession(record) : null;
    },
    async findSessionByCommandId(commandId) {
      const record = Array.from(sessions.values()).find((item) => item.commandId === commandId);
      return record ? cloneSession(record) : null;
    },
    async createSession(input) {
      const existing = input.bootId
        ? Array.from(sessions.values()).find((item) => item.devicePk === input.devicePk && item.bootId === input.bootId)
        : input.commandId
          ? Array.from(sessions.values()).find((item) => item.devicePk === input.devicePk && item.commandId === input.commandId)
          : undefined;
      if (existing) return cloneSession(existing);
      const record = { ...input, sessionId: id(), updatedAt: input.lastStageAt };
      sessions.set(record.sessionId, record);
      return cloneSession(record);
    },
    async findEventByKey(devicePk, eventKey) {
      const record = events.get(`${devicePk}:${eventKey}`);
      return record ? cloneEvent(record) : null;
    },
    async appendEvent(input) {
      const key = `${input.devicePk}:${input.eventKey}`;
      const existing = events.get(key);
      if (existing) return { event: cloneEvent(existing), created: false };
      const event = { ...input, eventId: id() };
      events.set(key, event);
      return { event: cloneEvent(event), created: true };
    },
    async updateSession(sessionId, patch) {
      const record = sessions.get(sessionId);
      if (!record) throw new Error("RECOVERY_SESSION_NOT_FOUND");
      Object.assign(record, patch);
      return cloneSession(record);
    },
    async findLatestSession(devicePk) {
      const record = Array.from(sessions.values())
        .filter((item) => item.devicePk === devicePk)
        .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0];
      return record ? cloneSession(record) : null;
    },
    async listEvents(sessionId: string) {
      return Array.from(events.values())
        .filter((event) => event.sessionId === sessionId)
        .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
        .map(cloneEvent);
    },
    listSessions() {
      return Array.from(sessions.values(), cloneSession);
    },
    allEvents() {
      return Array.from(events.values(), cloneEvent);
    }
  };
}

function sessionRecord(row: typeof deviceRecoverySessions.$inferSelect, deviceId: string): DeviceRecoverySessionRecord {
  return {
    sessionId: row.id,
    devicePk: row.deviceId,
    deviceId,
    commandId: row.commandId ?? undefined,
    bootId: row.bootId ?? undefined,
    source: row.source,
    channel: row.channel ?? undefined,
    stage: row.stage as DeviceRecoveryStage,
    resultStatus: row.resultStatus as DeviceRecoveryResultStatus | undefined,
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    startedAt: row.startedAt,
    lastStageAt: row.lastStageAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? undefined
  };
}

function eventRecord(row: typeof deviceRecoveryStageEvents.$inferSelect): DeviceRecoveryEventRecord {
  return {
    eventId: row.id,
    sessionId: row.sessionId,
    devicePk: row.deviceId,
    eventKey: row.eventKey,
    stage: row.stage as DeviceRecoveryStage,
    occurredAt: row.occurredAt,
    reportedAt: row.reportedAt,
    details: row.detailsJson ?? undefined
  };
}

export function createDatabaseDeviceRecoveryRepository(
  resolveDevice: (deviceCode: string) => Promise<RecoveryDevice | null>
): DeviceRecoveryRepository {
  async function loadSession(where: ReturnType<typeof and>, deviceId: string) {
    const [row] = await db.select().from(deviceRecoverySessions).where(where).limit(1);
    return row ? sessionRecord(row, deviceId) : null;
  }

  return {
    findDeviceByCode: resolveDevice,
    findSessionById(sessionId, devicePk) {
      return loadSession(and(
        eq(deviceRecoverySessions.tenantId, config.tenantId),
        eq(deviceRecoverySessions.id, sessionId),
        eq(deviceRecoverySessions.deviceId, devicePk)
      ), "");
    },
    findSessionByBoot(devicePk, bootId) {
      return loadSession(and(
        eq(deviceRecoverySessions.tenantId, config.tenantId),
        eq(deviceRecoverySessions.deviceId, devicePk),
        eq(deviceRecoverySessions.bootId, bootId)
      ), "");
    },
    findSessionByCommand(devicePk, commandId) {
      return loadSession(and(
        eq(deviceRecoverySessions.tenantId, config.tenantId),
        eq(deviceRecoverySessions.deviceId, devicePk),
        eq(deviceRecoverySessions.commandId, commandId)
      ), "");
    },
    findSessionByCommandId(commandId) {
      return loadSession(and(
        eq(deviceRecoverySessions.tenantId, config.tenantId),
        eq(deviceRecoverySessions.commandId, commandId)
      ), "");
    },
    async createSession(input) {
      const [created] = await db.insert(deviceRecoverySessions).values({
        tenantId: config.tenantId,
        deviceId: input.devicePk,
        commandId: input.commandId,
        bootId: input.bootId,
        source: input.source,
        channel: input.channel,
        stage: input.stage,
        startedAt: input.startedAt,
        lastStageAt: input.lastStageAt,
        createdBy: "mobile_agent",
        updatedBy: "mobile_agent"
      }).onConflictDoNothing().returning();
      if (created) return sessionRecord(created, input.deviceId);
      const existing = input.bootId
        ? await this.findSessionByBoot(input.devicePk, input.bootId)
        : input.commandId
          ? await this.findSessionByCommand(input.devicePk, input.commandId)
          : null;
      if (!existing) throw new Error("RECOVERY_SESSION_CREATE_CONFLICT");
      return { ...existing, deviceId: input.deviceId };
    },
    async findEventByKey(devicePk, eventKey) {
      const [row] = await db.select().from(deviceRecoveryStageEvents).where(and(
        eq(deviceRecoveryStageEvents.tenantId, config.tenantId),
        eq(deviceRecoveryStageEvents.deviceId, devicePk),
        eq(deviceRecoveryStageEvents.eventKey, eventKey)
      )).limit(1);
      return row ? eventRecord(row) : null;
    },
    async appendEvent(input) {
      const [created] = await db.insert(deviceRecoveryStageEvents).values({
        tenantId: config.tenantId,
        sessionId: input.sessionId,
        deviceId: input.devicePk,
        eventKey: input.eventKey,
        stage: input.stage,
        occurredAt: input.occurredAt,
        reportedAt: input.reportedAt,
        detailsJson: input.details,
        createdBy: "mobile_agent",
        updatedBy: "mobile_agent"
      }).onConflictDoNothing().returning();
      if (created) return { event: eventRecord(created), created: true };
      const existing = await this.findEventByKey(input.devicePk, input.eventKey);
      if (!existing) throw new Error("RECOVERY_EVENT_CREATE_CONFLICT");
      return { event: existing, created: false };
    },
    async updateSession(sessionId, patch) {
      const nextStage = patch.stage;
      const advancesStage = nextStage ? sql<boolean>`
        array_position(
          array['WAITING_DEVICE','SYSTEM_BOOTED','NETWORK_CONNECTED','AGENT_LAUNCHED','DEVICE_REGISTERED','HEARTBEAT_RESTORED','COMMAND_CHANNEL_READY']::varchar[],
          ${deviceRecoverySessions.stage}
        ) < array_position(
          array['WAITING_DEVICE','SYSTEM_BOOTED','NETWORK_CONNECTED','AGENT_LAUNCHED','DEVICE_REGISTERED','HEARTBEAT_RESTORED','COMMAND_CHANNEL_READY']::varchar[],
          ${nextStage}
        )
      ` : undefined;
      const [row] = await db.update(deviceRecoverySessions).set({
        stage: nextStage && advancesStage
          ? sql`case when ${advancesStage} then ${nextStage} else ${deviceRecoverySessions.stage} end`
          : undefined,
        lastStageAt: patch.lastStageAt && advancesStage
          ? sql`case when ${advancesStage} then ${patch.lastStageAt} else ${deviceRecoverySessions.lastStageAt} end`
          : undefined,
        resultStatus: patch.resultStatus,
        errorCode: patch.errorCode,
        errorMessage: patch.errorMessage,
        completedAt: patch.completedAt,
        updatedAt: patch.updatedAt,
        updatedBy: "mobile_agent"
      }).where(and(
        eq(deviceRecoverySessions.tenantId, config.tenantId),
        eq(deviceRecoverySessions.id, sessionId)
      )).returning();
      if (!row) throw new Error("RECOVERY_SESSION_NOT_FOUND");
      return sessionRecord(row, "");
    },
    async findLatestSession(devicePk) {
      const [row] = await db.select().from(deviceRecoverySessions).where(and(
        eq(deviceRecoverySessions.tenantId, config.tenantId),
        eq(deviceRecoverySessions.deviceId, devicePk)
      )).orderBy(desc(deviceRecoverySessions.startedAt)).limit(1);
      return row ? sessionRecord(row, "") : null;
    },
    async listEvents(sessionId) {
      const rows = await db.select().from(deviceRecoveryStageEvents).where(and(
        eq(deviceRecoveryStageEvents.tenantId, config.tenantId),
        eq(deviceRecoveryStageEvents.sessionId, sessionId)
      )).orderBy(deviceRecoveryStageEvents.occurredAt);
      return rows.map(eventRecord);
    }
  };
}
