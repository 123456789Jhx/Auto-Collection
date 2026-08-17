import {
  interfacePublishConfirmRunPayloadSchema,
  interfacePublishRunConfigSchema,
  type InterfacePublishBindingStatus,
  type InterfacePublishConfirmRunPayload,
  type InterfacePublishRunConfig,
  type InterfacePublishRunStatus
} from "@pkg/types";
import {
  publishInterfaceRunRepository,
  type InterfacePublishRunBindingSnapshot,
  type PublishInterfaceRunRepository
} from "../repositories/publish-interface-run.repository";
import { publishInterfaceBindingService } from "./publish-interface-binding.service";
import { businessDateInShanghai, validateManualRunStart } from "./publish-interface-start-time";

type PreflightRow = Awaited<ReturnType<typeof publishInterfaceBindingService.preflight>>[number];

type RunServiceDependencies = {
  repository?: PublishInterfaceRunRepository;
  preflight?: () => Promise<PreflightRow[]>;
  now?: () => Date;
};

export class PublishInterfaceRunServiceError extends Error {
  constructor(
    readonly code:
      | "RUN_ALREADY_ACTIVE"
      | "RUN_NOT_FOUND"
      | "RUN_STATE_INVALID"
      | "RUN_SKIP_BINDING_INVALID"
      | "MORNING_PUBLISH_TIME_PASSED"
      | "AFTERNOON_PUBLISH_TIME_PASSED",
    readonly userMessage: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(code);
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function completeSnapshot(
  row: PreflightRow,
  skippedBindingIds: Set<string>
): InterfacePublishRunBindingSnapshot | null {
  if (!row.bindingId || !row.deviceId || !row.accountName || !row.accountNo || !row.externalAccountKey) return null;
  const eligibleStatuses: InterfacePublishBindingStatus[] = ["MATCHED", "DEVICE_OFFLINE", "DEVICE_BUSY"];
  if (!eligibleStatuses.includes(row.status)) return null;
  const skippedForRun = skippedBindingIds.has(row.bindingId);
  return {
    bindingId: row.bindingId,
    deviceId: row.deviceId,
    deviceCode: row.deviceCode,
    accountName: row.accountName,
    accountNo: row.accountNo,
    externalAccountKey: row.externalAccountKey,
    status: skippedForRun ? "SKIPPED_FOR_RUN" : row.status,
    reservationStatus: skippedForRun ? "RELEASED" : "WAITING_DEVICE",
    skippedForRun
  };
}

export function createPublishInterfaceRunService(dependencies: RunServiceDependencies = {}) {
  const repository = dependencies.repository ?? publishInterfaceRunRepository;
  const preflight = dependencies.preflight ?? (() => publishInterfaceBindingService.preflight());
  const now = dependencies.now ?? (() => new Date());

  async function requireTransition(
    runId: string,
    expected: InterfacePublishRunStatus[],
    status: InterfacePublishRunStatus,
    actor: string
  ) {
    const run = await repository.transition(runId, expected, status, actor);
    if (!run) throw new PublishInterfaceRunServiceError("RUN_STATE_INVALID", "当前运行状态不允许执行此操作");
    return run;
  }

  return {
    async create(configInput: InterfacePublishRunConfig, actor: string) {
      const config = interfacePublishRunConfigSchema.parse(configInput);
      const startTime = validateManualRunStart(config, now());
      if (!startTime.valid) {
        throw new PublishInterfaceRunServiceError(startTime.code, startTime.message, {
          businessDate: startTime.businessDate
        });
      }

      let created;
      try {
        created = await repository.create({ config, actor });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PublishInterfaceRunServiceError("RUN_ALREADY_ACTIVE", "已有正在运行的接口发布总任务");
        }
        throw error;
      }

      try {
        const result = await preflight();
        const run = await requireTransition(
          created.id,
          ["CHECKING_BINDINGS"],
          "WAITING_USER_CONFIRMATION",
          actor
        );
        return { run, preflight: result, startTime };
      } catch (error) {
        await repository.transition(created.id, ["CHECKING_BINDINGS"], "FAILED", actor);
        throw error;
      }
    },

    async confirm(runId: string, payloadInput: InterfacePublishConfirmRunPayload, actor: string) {
      const payload = interfacePublishConfirmRunPayloadSchema.parse(payloadInput);
      const result = await preflight();
      const knownBindingIds = new Set(result.flatMap((row) => row.bindingId ? [row.bindingId] : []));
      const unknownSkippedIds = payload.skippedBindingIds.filter((id) => !knownBindingIds.has(id));
      if (unknownSkippedIds.length) {
        throw new PublishInterfaceRunServiceError(
          "RUN_SKIP_BINDING_INVALID",
          "本次跳过列表包含当前预检中不存在的绑定",
          { bindingIds: unknownSkippedIds }
        );
      }
      const skippedBindingIds = new Set(payload.skippedBindingIds);
      const bindings = result
        .map((row) => completeSnapshot(row, skippedBindingIds))
        .filter((row): row is InterfacePublishRunBindingSnapshot => row !== null);
      const confirmed = await repository.confirm({ runId, actor, bindings });
      if (!confirmed) {
        const run = await repository.findById(runId);
        throw new PublishInterfaceRunServiceError(
          run ? "RUN_STATE_INVALID" : "RUN_NOT_FOUND",
          run ? "当前运行状态不允许确认" : "接口发布运行不存在"
        );
      }
      return confirmed;
    },

    getCurrent() {
      return repository.findCurrent();
    },

    async getById(runId: string) {
      const run = await repository.findById(runId);
      if (!run) throw new PublishInterfaceRunServiceError("RUN_NOT_FOUND", "接口发布运行不存在");
      return run;
    },

    async getStopRisk(runId: string) {
      const run = await repository.findById(runId);
      if (!run) throw new PublishInterfaceRunServiceError("RUN_NOT_FOUND", "接口发布运行不存在");
      const businessDate = businessDateInShanghai(now());
      return {
        businessDate,
        incompleteAccountCount: await repository.countBindingsWithoutPublishedSlot(runId, businessDate)
      };
    },

    markRunning(runId: string, actor: string) {
      return requireTransition(runId, ["SCHEDULED"], "RUNNING", actor);
    },

    requestStop(runId: string, actor: string) {
      return requireTransition(runId, ["SCHEDULED", "RUNNING"], "STOPPING", actor);
    },

    markStopped(runId: string, actor: string) {
      return requireTransition(runId, ["STOPPING"], "STOPPED", actor);
    },

    pause(runId: string, actor: string) {
      return requireTransition(runId, ["SCHEDULED", "RUNNING"], "PAUSED", actor);
    },

    fail(runId: string, actor: string) {
      return requireTransition(
        runId,
        ["CHECKING_BINDINGS", "WAITING_USER_CONFIRMATION", "SCHEDULED", "RUNNING", "PAUSED"],
        "FAILED",
        actor
      );
    }
  };
}

export const publishInterfaceRunService = createPublishInterfaceRunService();
