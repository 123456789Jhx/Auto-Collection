import {
  DEVICE_RECOVERY_STAGES,
  deviceRecoveryStageReportSchema,
  type DeviceRecoveryStageReport
} from "@pkg/types";
import type {
  DeviceRecoveryEventRecord,
  DeviceRecoveryRepository,
  DeviceRecoverySessionRecord
} from "./device-recovery.repository";
import { evaluateDeviceRecoveryTimeout, projectDeviceRecovery } from "./device-recovery-timeout";

const stageOrder = new Map(DEVICE_RECOVERY_STAGES.map((stage, index) => [stage, index]));

function publicSession(session: DeviceRecoverySessionRecord) {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    commandId: session.commandId,
    bootId: session.bootId,
    source: session.source,
    channel: session.channel,
    stage: session.stage,
    resultStatus: session.resultStatus,
    errorCode: session.errorCode,
    errorMessage: session.errorMessage,
    startedAt: session.startedAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    completedAt: session.completedAt?.toISOString()
  };
}

function publicEvent(event: DeviceRecoveryEventRecord) {
  return {
    eventId: event.eventId,
    eventKey: event.eventKey,
    stage: event.stage,
    occurredAt: event.occurredAt.toISOString(),
    reportedAt: event.reportedAt.toISOString(),
    details: event.details
  };
}

export function createDeviceRecoveryService(dependencies: {
  repository: DeviceRecoveryRepository;
  now?: () => Date;
}) {
  const repository = dependencies.repository;
  const now = dependencies.now ?? (() => new Date());

  function recoveryErrorCode(value?: string) {
    const allowed = new Set([
      "DEVICE_UNREACHABLE", "NETWORK_READY_TIMEOUT", "AGENT_LAUNCH_TIMEOUT",
      "DEVICE_REGISTRATION_TIMEOUT", "HEARTBEAT_RESTORE_TIMEOUT", "COMMAND_CHANNEL_TIMEOUT",
      "SCREEN_WAKE_FAILED", "KEYGUARD_DISMISS_FAILED", "APP_LAUNCH_FAILED",
      "SECURE_KEYGUARD_REQUIRES_USER"
    ]);
    return value && allowed.has(value) ? value : "DEVICE_UNREACHABLE";
  }

  async function resolveSession(report: DeviceRecoveryStageReport, devicePk: string) {
    let session = report.sessionId
      ? await repository.findSessionById(report.sessionId, devicePk)
      : null;
    if (!session && report.bootId) session = await repository.findSessionByBoot(devicePk, report.bootId);
    if (!session && report.commandId) session = await repository.findSessionByCommand(devicePk, report.commandId);
    if (session) return session;
    if (report.source === "AUTO_BOOT" && !report.bootId) throw new Error("BOOT_ID_REQUIRED");
    if (report.source === "MANUAL_WAKE" && !report.commandId) throw new Error("COMMAND_ID_REQUIRED");
    const occurredAt = new Date(report.occurredAt);
    return repository.createSession({
      devicePk,
      deviceId: report.deviceId,
      commandId: report.commandId,
      bootId: report.bootId,
      source: report.source,
      channel: report.channel,
      stage: "WAITING_DEVICE",
      startedAt: occurredAt,
      lastStageAt: occurredAt
    });
  }

  return {
    async startManualWake(input: {
      deviceId: string;
      commandId: string;
      channel: "AGENT_POLL" | "XIAOMI_PUSH";
    }) {
      const device = await repository.findDeviceByCode(input.deviceId);
      if (!device) throw new Error("DEVICE_NOT_FOUND");
      const existing = await repository.findSessionByCommand(device.id, input.commandId);
      if (existing) return publicSession({ ...existing, deviceId: device.deviceCode });
      const startedAt = now();
      const session = await repository.createSession({
        devicePk: device.id,
        deviceId: device.deviceCode,
        commandId: input.commandId,
        source: "MANUAL_WAKE",
        channel: input.channel,
        stage: "WAITING_DEVICE",
        startedAt,
        lastStageAt: startedAt
      });
      return publicSession(session);
    },

    async completeManualWake(commandId: string, result: {
      status: "SUCCEEDED" | "FAILED" | "TIMED_OUT";
      errorCode?: string;
      errorMessage?: string;
    }) {
      let session = await repository.findSessionByCommandId(commandId);
      if (!session) return null;
      if (session.resultStatus) return publicSession(session);
      const completedAt = now();
      if (result.status === "SUCCEEDED") {
        await repository.appendEvent({
          sessionId: session.sessionId,
          devicePk: session.devicePk,
          eventKey: `${commandId}:COMMAND_CHANNEL_READY`,
          stage: "COMMAND_CHANNEL_READY",
          occurredAt: completedAt,
          reportedAt: completedAt,
          details: { terminalAck: true }
        });
      }
      session = await repository.updateSession(session.sessionId, {
        stage: result.status === "SUCCEEDED" ? "COMMAND_CHANNEL_READY" : session.stage,
        lastStageAt: result.status === "SUCCEEDED" ? completedAt : session.lastStageAt,
        resultStatus: result.status,
        errorCode: result.status === "SUCCEEDED" ? undefined : recoveryErrorCode(result.errorCode),
        errorMessage: result.errorMessage,
        completedAt,
        updatedAt: completedAt
      });
      return publicSession(session);
    },

    async reportStage(input: unknown) {
      const report = deviceRecoveryStageReportSchema.parse(input);
      const device = await repository.findDeviceByCode(report.deviceId);
      if (!device) throw new Error("DEVICE_NOT_FOUND");
      const existingEvent = await repository.findEventByKey(device.id, report.eventKey);
      if (existingEvent) {
        const existingSession = await repository.findSessionById(existingEvent.sessionId, device.id);
        if (!existingSession) throw new Error("RECOVERY_SESSION_NOT_FOUND");
        return { session: publicSession({ ...existingSession, deviceId: device.deviceCode }), event: publicEvent(existingEvent), duplicate: true };
      }

      let session = await resolveSession(report, device.id);
      if (session.source !== report.source) throw new Error("RECOVERY_SOURCE_MISMATCH");
      const appended = await repository.appendEvent({
        sessionId: session.sessionId,
        devicePk: device.id,
        eventKey: report.eventKey,
        stage: report.stage,
        occurredAt: new Date(report.occurredAt),
        reportedAt: new Date(report.reportedAt),
        details: report.details
      });
      if (!appended.created) {
        const duplicateSession = await repository.findSessionById(appended.event.sessionId, device.id);
        if (!duplicateSession) throw new Error("RECOVERY_SESSION_NOT_FOUND");
        return { session: publicSession({ ...duplicateSession, deviceId: device.deviceCode }), event: publicEvent(appended.event), duplicate: true };
      }

      const advances = (stageOrder.get(report.stage) ?? -1) > (stageOrder.get(session.stage) ?? -1);
      if (advances || report.stage === "COMMAND_CHANNEL_READY") {
        const occurredAt = new Date(report.occurredAt);
        session = await repository.updateSession(session.sessionId, {
          stage: advances ? report.stage : session.stage,
          lastStageAt: advances ? occurredAt : session.lastStageAt,
          resultStatus: report.stage === "COMMAND_CHANNEL_READY" ? "SUCCEEDED" : session.resultStatus,
          completedAt: report.stage === "COMMAND_CHANNEL_READY" ? occurredAt : session.completedAt,
          updatedAt: new Date(report.reportedAt)
        });
      }
      return { session: publicSession({ ...session, deviceId: device.deviceCode }), event: publicEvent(appended.event), duplicate: false };
    },

    async getLatest(deviceCode: string) {
      const device = await repository.findDeviceByCode(deviceCode);
      if (!device) throw new Error("DEVICE_NOT_FOUND");
      let session = await repository.findLatestSession(device.id);
      if (!session) return null;
      const timeout = evaluateDeviceRecoveryTimeout(session, now());
      if (timeout) {
        session = await repository.updateSession(session.sessionId, {
          resultStatus: timeout.resultStatus,
          errorCode: timeout.errorCode,
          errorMessage: timeout.errorMessage,
          completedAt: timeout.completedAt,
          updatedAt: timeout.completedAt
        });
      }
      const events = await repository.listEvents(session.sessionId);
      return {
        session: publicSession({ ...session, deviceId: device.deviceCode }),
        events: events.map(publicEvent),
        projection: projectDeviceRecovery(session, now())
      };
    }
  };
}
