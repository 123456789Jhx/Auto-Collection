import {
  collectorDevices,
  commerceCardApprovalConsumptions,
  commerceCardExecutionApprovals,
  deviceTaskAssignmentEvents,
  deviceTaskAssignments,
  featureRolloutControls,
  liveCommentActions,
  liveTargetFeatureConfigs,
  liveTargets
} from "@pkg/db/schema";
import { and, desc, eq, gte, inArray, isNull, sql, sum } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";
import { AssignmentRuntimeError, TERMINAL_ASSIGNMENT_STATUSES } from "./task-assignment.repository";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isTerminalAssignmentStatus(status: string) {
  return TERMINAL_ASSIGNMENT_STATUSES.includes(status as typeof TERMINAL_ASSIGNMENT_STATUSES[number]);
}

async function lockQuotaScopes(
  transaction: DatabaseTransaction,
  expectedAccountId: string,
  targetId: string
) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext('commerce_card_account'), hashtext(${expectedAccountId}))`
  );
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext('commerce_card_target'), hashtext(${targetId}))`
  );
}

async function lockAssignment(transaction: DatabaseTransaction, assignmentId: string) {
  const [assignment] = await transaction
    .select()
    .from(deviceTaskAssignments)
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.id, assignmentId),
      isNull(deviceTaskAssignments.deletedAt)
    ))
    .limit(1)
    .for("update");
  return assignment ?? null;
}

async function assertCommentRuntimeEnabled(
  transaction: DatabaseTransaction,
  assignment: typeof deviceTaskAssignments.$inferSelect
) {
  const [control] = await transaction
    .select()
    .from(featureRolloutControls)
    .where(and(
      eq(featureRolloutControls.tenantId, config.tenantId),
      eq(featureRolloutControls.featureKey, "commerce_card_real_comment"),
      isNull(featureRolloutControls.deletedAt)
    ))
    .limit(1);
  if (!control?.enabled) {
    throw new AssignmentRuntimeError("REAL_COMMENT_FEATURE_DISABLED");
  }
  if (!assignment.selectedTargetId || !assignment.configHash) {
    throw new AssignmentRuntimeError("ASSIGNMENT_SNAPSHOT_INCOMPLETE");
  }
  const [featureConfig] = await transaction
    .select()
    .from(liveTargetFeatureConfigs)
    .where(and(
      eq(liveTargetFeatureConfigs.tenantId, config.tenantId),
      eq(liveTargetFeatureConfigs.targetId, assignment.selectedTargetId),
      eq(liveTargetFeatureConfigs.featureType, "commerce_card_live_comment"),
      isNull(liveTargetFeatureConfigs.deletedAt)
    ))
    .limit(1)
    .for("update");
  const runtimeConfig = featureConfig?.runtimeConfigJson ?? {};
  if (!featureConfig?.enabled || runtimeConfig.executeEnabled !== true) {
    throw new AssignmentRuntimeError("COMMERCE_CARD_EXECUTE_DISABLED");
  }
  if (featureConfig.configHash !== assignment.configHash) {
    throw new AssignmentRuntimeError("ASSIGNMENT_CONFIG_HASH_STALE");
  }
  return featureConfig;
}

async function lockConsumedActionApproval(
  transaction: DatabaseTransaction,
  assignment: typeof deviceTaskAssignments.$inferSelect,
  action: typeof liveCommentActions.$inferSelect,
  commentPoolHash?: string
) {
  if (
    !assignment.executionApprovalId ||
    !assignment.selectedTargetId ||
    !assignment.expectedAccountId ||
    !action.approvalId ||
    action.approvalId !== assignment.executionApprovalId
  ) {
    throw new AssignmentRuntimeError("EXECUTION_APPROVAL_REQUIRED");
  }

  const [approval] = await transaction
    .select()
    .from(commerceCardExecutionApprovals)
    .where(and(
      eq(commerceCardExecutionApprovals.tenantId, config.tenantId),
      eq(commerceCardExecutionApprovals.id, assignment.executionApprovalId),
      isNull(commerceCardExecutionApprovals.deletedAt)
    ))
    .limit(1)
    .for("update");
  if (!approval) {
    throw new AssignmentRuntimeError("EXECUTION_APPROVAL_NOT_FOUND");
  }

  const [consumption] = await transaction
    .select({ id: commerceCardApprovalConsumptions.id })
    .from(commerceCardApprovalConsumptions)
    .where(and(
      eq(commerceCardApprovalConsumptions.tenantId, config.tenantId),
      eq(commerceCardApprovalConsumptions.approvalId, approval.id),
      eq(commerceCardApprovalConsumptions.actionId, action.id),
      isNull(commerceCardApprovalConsumptions.deletedAt)
    ))
    .limit(1);
  if (!consumption) {
    throw new AssignmentRuntimeError("EXECUTION_APPROVAL_CONSUMPTION_NOT_FOUND");
  }

  const now = Date.now();
  if (
    !["ACTIVE", "EXHAUSTED"].includes(approval.status) ||
    approval.validFrom.getTime() > now ||
    approval.expiresAt.getTime() <= now
  ) {
    throw new AssignmentRuntimeError("EXECUTION_APPROVAL_INACTIVE", { status: approval.status });
  }
  if (
    approval.targetId !== assignment.selectedTargetId ||
    approval.deviceId !== assignment.deviceId ||
    approval.expectedAccountId !== assignment.expectedAccountId ||
    approval.configHash !== assignment.configHash ||
    action.targetId !== assignment.selectedTargetId ||
    action.expectedAccountId !== assignment.expectedAccountId ||
    (commentPoolHash !== undefined && approval.commentPoolHash !== commentPoolHash)
  ) {
    throw new AssignmentRuntimeError("EXECUTION_APPROVAL_SCOPE_MISMATCH");
  }
  return approval;
}

export async function createCommerceCardExecutionApproval(
  values: typeof commerceCardExecutionApprovals.$inferInsert
) {
  const [approval] = await db.insert(commerceCardExecutionApprovals).values(values).returning();
  return approval;
}

export async function findCommerceCardExecutionApprovalById(approvalId: string) {
  const [approval] = await db
    .select()
    .from(commerceCardExecutionApprovals)
    .where(and(
      eq(commerceCardExecutionApprovals.tenantId, config.tenantId),
      eq(commerceCardExecutionApprovals.id, approvalId),
      isNull(commerceCardExecutionApprovals.deletedAt)
    ))
    .limit(1);
  return approval ?? null;
}

export async function listCommerceCardExecutionApprovals(limit = 200) {
  const rows = await db
    .select({
      id: commerceCardExecutionApprovals.id,
      targetId: commerceCardExecutionApprovals.targetId,
      targetCode: liveTargets.targetCode,
      targetName: liveTargets.targetName,
      deviceId: commerceCardExecutionApprovals.deviceId,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName,
      expectedAccountId: commerceCardExecutionApprovals.expectedAccountId,
      expectedAccountName: commerceCardExecutionApprovals.expectedAccountName,
      configHash: commerceCardExecutionApprovals.configHash,
      commentPoolHash: commerceCardExecutionApprovals.commentPoolHash,
      maxCommentsPerRoom: commerceCardExecutionApprovals.maxCommentsPerRoom,
      totalQuota: commerceCardExecutionApprovals.totalQuota,
      consumedQuota: commerceCardExecutionApprovals.consumedQuota,
      accountDailyLimit: commerceCardExecutionApprovals.accountDailyLimit,
      targetDailyLimit: commerceCardExecutionApprovals.targetDailyLimit,
      cooldownSeconds: commerceCardExecutionApprovals.cooldownSeconds,
      status: commerceCardExecutionApprovals.status,
      revision: commerceCardExecutionApprovals.revision,
      validFrom: commerceCardExecutionApprovals.validFrom,
      expiresAt: commerceCardExecutionApprovals.expiresAt,
      approvedBy: commerceCardExecutionApprovals.approvedBy,
      approvedAt: commerceCardExecutionApprovals.approvedAt,
      revokedBy: commerceCardExecutionApprovals.revokedBy,
      revokedAt: commerceCardExecutionApprovals.revokedAt,
      revokeReason: commerceCardExecutionApprovals.revokeReason,
      reason: commerceCardExecutionApprovals.reason,
      createdAt: commerceCardExecutionApprovals.createdAt,
      updatedAt: commerceCardExecutionApprovals.updatedAt
    })
    .from(commerceCardExecutionApprovals)
    .innerJoin(liveTargets, eq(commerceCardExecutionApprovals.targetId, liveTargets.id))
    .innerJoin(collectorDevices, eq(commerceCardExecutionApprovals.deviceId, collectorDevices.id))
    .where(and(
      eq(commerceCardExecutionApprovals.tenantId, config.tenantId),
      isNull(commerceCardExecutionApprovals.deletedAt),
      isNull(liveTargets.deletedAt),
      isNull(collectorDevices.deletedAt)
    ))
    .orderBy(desc(commerceCardExecutionApprovals.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    effectiveStatus: row.status === "ACTIVE" && row.expiresAt.getTime() <= Date.now() ? "EXPIRED" : row.status,
    remainingQuota: Math.max(0, row.totalQuota - row.consumedQuota)
  }));
}

export async function revokeCommerceCardExecutionApprovalAtomic(input: {
  approvalId: string;
  expectedRevision: number;
  actor: string;
  reason: string;
}) {
  return db.transaction(async (transaction) => {
    const [approval] = await transaction
      .select()
      .from(commerceCardExecutionApprovals)
      .where(and(
        eq(commerceCardExecutionApprovals.tenantId, config.tenantId),
        eq(commerceCardExecutionApprovals.id, input.approvalId),
        isNull(commerceCardExecutionApprovals.deletedAt)
      ))
      .limit(1)
      .for("update");
    if (!approval) {
      throw new AssignmentRuntimeError("EXECUTION_APPROVAL_NOT_FOUND");
    }
    if (approval.revision !== input.expectedRevision) {
      throw new AssignmentRuntimeError("EXECUTION_APPROVAL_REVISION_CONFLICT", {
        currentRevision: approval.revision
      });
    }
    if (approval.status !== "ACTIVE") {
      return approval;
    }
    const now = new Date();
    const [updated] = await transaction
      .update(commerceCardExecutionApprovals)
      .set({
        status: "REVOKED",
        revision: approval.revision + 1,
        revokedBy: input.actor,
        revokedAt: now,
        revokeReason: input.reason,
        updatedAt: now,
        updatedBy: input.actor
      })
      .where(eq(commerceCardExecutionApprovals.id, approval.id))
      .returning();
    return updated ?? approval;
  });
}

export async function reserveCommerceCardCommentActionAtomic(input: {
  assignmentId: string;
  deviceId: string;
  expectedStateVersion: number;
  currentAccountIdentity: string;
  roomKeyVersion: number;
  roomKey: string;
  commentSlot: number;
  commentHash: string;
  replyText: string;
  idempotencyKey: string;
  permitTokenHash: string;
  permitExpiresAt: Date;
  commentPoolHash: string;
  dayStart: Date;
}) {
  return db.transaction(async (transaction) => {
    const assignment = await lockAssignment(transaction, input.assignmentId);
    if (!assignment || assignment.deviceId !== input.deviceId) {
      throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
    }
    if (assignment.status !== "RUNNING" || assignment.blockReason) {
      throw new AssignmentRuntimeError("ASSIGNMENT_NOT_COMMENTABLE", {
        state: assignment.status,
        blockReason: assignment.blockReason
      });
    }
    if (assignment.expiresAt && assignment.expiresAt.getTime() <= Date.now()) {
      throw new AssignmentRuntimeError("ASSIGNMENT_EXPIRED");
    }
    if (assignment.stateVersion !== input.expectedStateVersion) {
      throw new AssignmentRuntimeError("ASSIGNMENT_STATE_VERSION_CONFLICT", {
        expectedStateVersion: input.expectedStateVersion,
        currentStateVersion: assignment.stateVersion
      });
    }
    if (!assignment.selectedTargetId) {
      throw new AssignmentRuntimeError("ASSIGNMENT_SNAPSHOT_INCOMPLETE");
    }
    if (assignment.expectedAccountId && assignment.expectedAccountId !== input.currentAccountIdentity) {
      throw new AssignmentRuntimeError("EXPECTED_ACCOUNT_MISMATCH");
    }
    const [existingAction] = await transaction
      .select()
      .from(liveCommentActions)
      .where(and(
        eq(liveCommentActions.tenantId, config.tenantId),
        eq(liveCommentActions.idempotencyKey, input.idempotencyKey)
      ))
      .limit(1)
      .for("update");
    if (existingAction) {
      const identityMatches =
        existingAction.assignmentId === assignment.id &&
        existingAction.targetId === assignment.selectedTargetId &&
        existingAction.expectedAccountId === assignment.expectedAccountId &&
        existingAction.roomKeyVersion === input.roomKeyVersion &&
        existingAction.roomKey === input.roomKey &&
        existingAction.commentSlot === input.commentSlot &&
        existingAction.commentHash === input.commentHash;
      if (!identityMatches) {
        throw new AssignmentRuntimeError("IDEMPOTENCY_CONFLICT");
      }
      if (existingAction.actionState === "planned") {
        await assertCommentRuntimeEnabled(transaction, assignment);
        if (assignment.executionApprovalId) {
          await lockConsumedActionApproval(transaction, assignment, existingAction, input.commentPoolHash);
        }
        const [refreshed] = await transaction
          .update(liveCommentActions)
          .set({
            permitTokenHash: input.permitTokenHash,
            permitExpiresAt: input.permitExpiresAt,
            updatedAt: new Date(),
            updatedBy: "mobile_agent"
          })
          .where(eq(liveCommentActions.id, existingAction.id))
          .returning();
        return { assignment, action: refreshed ?? existingAction, idempotent: true, permitIssued: true };
      }
      return { assignment, action: existingAction, idempotent: true, permitIssued: false };
    }

    await assertCommentRuntimeEnabled(transaction, assignment);

    const expectedAccountCondition = assignment.expectedAccountId
      ? eq(liveCommentActions.expectedAccountId, assignment.expectedAccountId)
      : isNull(liveCommentActions.expectedAccountId);
    const [physicalSlot] = await transaction
      .select({ id: liveCommentActions.id, actionState: liveCommentActions.actionState })
      .from(liveCommentActions)
      .where(and(
        eq(liveCommentActions.tenantId, config.tenantId),
        eq(liveCommentActions.assignmentId, assignment.id),
        eq(liveCommentActions.targetId, assignment.selectedTargetId),
        expectedAccountCondition,
        eq(liveCommentActions.roomKeyVersion, input.roomKeyVersion),
        eq(liveCommentActions.roomKey, input.roomKey),
        eq(liveCommentActions.commentSlot, input.commentSlot)
      ))
      .limit(1);
    if (physicalSlot) {
      throw new AssignmentRuntimeError("COMMENT_SLOT_ALREADY_RESERVED", {
        actionId: physicalSlot.id,
        actionState: physicalSlot.actionState
      });
    }

    const now = new Date();
    let approval: typeof commerceCardExecutionApprovals.$inferSelect | null = null;
    if (assignment.executionApprovalId) {
      if (!assignment.expectedAccountId) {
        throw new AssignmentRuntimeError("EXPECTED_ACCOUNT_REQUIRED_FOR_APPROVAL");
      }
      const [approvalRow] = await transaction
        .select()
        .from(commerceCardExecutionApprovals)
        .where(and(
          eq(commerceCardExecutionApprovals.tenantId, config.tenantId),
          eq(commerceCardExecutionApprovals.id, assignment.executionApprovalId),
          isNull(commerceCardExecutionApprovals.deletedAt)
        ))
        .limit(1)
        .for("update");
      approval = approvalRow ?? null;
      if (
        !approval ||
        approval.status !== "ACTIVE" ||
        approval.validFrom.getTime() > now.getTime() ||
        approval.expiresAt.getTime() <= now.getTime() ||
        approval.consumedQuota >= approval.totalQuota
      ) {
        throw new AssignmentRuntimeError("EXECUTION_APPROVAL_INACTIVE");
      }
      if (
        approval.targetId !== assignment.selectedTargetId ||
        approval.deviceId !== assignment.deviceId ||
        approval.expectedAccountId !== assignment.expectedAccountId ||
        approval.configHash !== assignment.configHash ||
        approval.commentPoolHash !== input.commentPoolHash ||
        input.commentSlot >= approval.maxCommentsPerRoom
      ) {
        throw new AssignmentRuntimeError("EXECUTION_APPROVAL_SCOPE_MISMATCH");
      }

      await lockQuotaScopes(transaction, assignment.expectedAccountId, assignment.selectedTargetId);

      const [accountDaily] = await transaction
        .select({ value: sum(commerceCardApprovalConsumptions.amount) })
        .from(commerceCardApprovalConsumptions)
        .where(and(
          eq(commerceCardApprovalConsumptions.tenantId, config.tenantId),
          eq(commerceCardApprovalConsumptions.expectedAccountId, assignment.expectedAccountId),
          gte(commerceCardApprovalConsumptions.consumedAt, input.dayStart),
          isNull(commerceCardApprovalConsumptions.deletedAt)
        ));
      const [targetDaily] = await transaction
        .select({ value: sum(commerceCardApprovalConsumptions.amount) })
        .from(commerceCardApprovalConsumptions)
        .where(and(
          eq(commerceCardApprovalConsumptions.tenantId, config.tenantId),
          eq(commerceCardApprovalConsumptions.targetId, assignment.selectedTargetId),
          gte(commerceCardApprovalConsumptions.consumedAt, input.dayStart),
          isNull(commerceCardApprovalConsumptions.deletedAt)
        ));
      const accountCount = Number(accountDaily?.value ?? 0);
      const targetCount = Number(targetDaily?.value ?? 0);
      if (accountCount >= approval.accountDailyLimit) {
        throw new AssignmentRuntimeError("APPROVAL_ACCOUNT_DAILY_LIMIT_REACHED");
      }
      if (targetCount >= approval.targetDailyLimit) {
        throw new AssignmentRuntimeError("APPROVAL_TARGET_DAILY_LIMIT_REACHED");
      }

      const [latestConsumption] = await transaction
        .select({ consumedAt: commerceCardApprovalConsumptions.consumedAt })
        .from(commerceCardApprovalConsumptions)
        .where(and(
          eq(commerceCardApprovalConsumptions.tenantId, config.tenantId),
          eq(commerceCardApprovalConsumptions.expectedAccountId, assignment.expectedAccountId),
          eq(commerceCardApprovalConsumptions.targetId, assignment.selectedTargetId),
          isNull(commerceCardApprovalConsumptions.deletedAt)
        ))
        .orderBy(desc(commerceCardApprovalConsumptions.consumedAt))
        .limit(1);
      if (
        latestConsumption &&
        approval.cooldownSeconds > 0 &&
        now.getTime() - latestConsumption.consumedAt.getTime() < approval.cooldownSeconds * 1000
      ) {
        throw new AssignmentRuntimeError("APPROVAL_COOLDOWN_ACTIVE", {
          availableAt: new Date(latestConsumption.consumedAt.getTime() + approval.cooldownSeconds * 1000).toISOString()
        });
      }
    }

    const [action] = await transaction
      .insert(liveCommentActions)
      .values({
        tenantId: config.tenantId,
        taskId: assignment.taskId,
        deviceId: assignment.deviceId,
        assignmentId: assignment.id,
        targetId: assignment.selectedTargetId,
        approvalId: approval?.id ?? null,
        stage: assignment.currentStage,
        expectedAccountId: assignment.expectedAccountId,
        expectedAccountName: assignment.expectedAccountName,
        roomKeyVersion: input.roomKeyVersion,
        roomKey: input.roomKey,
        commentSlot: input.commentSlot,
        commentHash: input.commentHash,
        attemptNo: 1,
        actionState: "planned",
        stateVersion: 1,
        idempotencyKey: input.idempotencyKey,
        permitTokenHash: input.permitTokenHash,
        permitExpiresAt: input.permitExpiresAt,
        triggerEventId: input.idempotencyKey,
        platform: "douyin",
        roomName: input.roomKey,
        replyText: input.replyText,
        status: "planned",
        plannedAt: now,
        reportedAt: now,
        rawPayload: {
          assignmentStateVersion: assignment.stateVersion,
          roomKeyVersion: input.roomKeyVersion,
          commentSlot: input.commentSlot
        },
        createdBy: "mobile_agent",
        updatedBy: "mobile_agent"
      })
      .returning();
    if (approval) {
      const expectedAccountId = assignment.expectedAccountId;
      if (!expectedAccountId) {
        throw new AssignmentRuntimeError("EXPECTED_ACCOUNT_REQUIRED_FOR_APPROVAL");
      }
      await transaction.insert(commerceCardApprovalConsumptions).values({
        tenantId: config.tenantId,
        approvalId: approval.id,
        assignmentId: assignment.id,
        actionId: action.id,
        deviceId: assignment.deviceId,
        targetId: assignment.selectedTargetId,
        expectedAccountId,
        amount: 1,
        consumedAt: now,
        createdBy: "mobile_agent",
        updatedBy: "mobile_agent"
      });
      const consumedQuota = approval.consumedQuota + 1;
      await transaction
        .update(commerceCardExecutionApprovals)
        .set({
          consumedQuota,
          status: consumedQuota >= approval.totalQuota ? "EXHAUSTED" : approval.status,
          revision: approval.revision + 1,
          updatedAt: now,
          updatedBy: "mobile_agent"
        })
        .where(eq(commerceCardExecutionApprovals.id, approval.id));
    }
    return { assignment, action, idempotent: false, permitIssued: true };
  });
}

const actionTransitions: Record<string, string[]> = {
  planned: ["submitting", "failed", "skipped"],
  submitting: ["submitted", "unknown", "failed", "skipped"],
  submitted: ["sent", "unknown"],
  sent: [],
  unknown: [],
  failed: [],
  skipped: []
};

export async function updateCommerceCardCommentActionAtomic(input: {
  assignmentId: string;
  actionId: string;
  deviceId: string;
  expectedActionStateVersion: number;
  nextState: "submitting" | "submitted" | "sent" | "unknown" | "failed" | "skipped";
  permitTokenHash?: string;
  failureReason?: string | null;
  evidence: Record<string, unknown>;
  payloadHash: string;
  occurredAt: Date;
}) {
  return db.transaction(async (transaction) => {
    const assignment = await lockAssignment(transaction, input.assignmentId);
    if (!assignment || assignment.deviceId !== input.deviceId) {
      throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
    }
    const [action] = await transaction
      .select()
      .from(liveCommentActions)
      .where(and(
        eq(liveCommentActions.tenantId, config.tenantId),
        eq(liveCommentActions.id, input.actionId),
        eq(liveCommentActions.assignmentId, assignment.id)
      ))
      .limit(1)
      .for("update");
    if (!action || !action.actionState) {
      throw new AssignmentRuntimeError("COMMENT_ACTION_NOT_FOUND");
    }
    if (
      action.stateVersion === input.expectedActionStateVersion + 1 &&
      action.actionState === input.nextState &&
      action.assignmentEventId
    ) {
      const [existingEvent] = await transaction
        .select()
        .from(deviceTaskAssignmentEvents)
        .where(and(
          eq(deviceTaskAssignmentEvents.tenantId, config.tenantId),
          eq(deviceTaskAssignmentEvents.id, action.assignmentEventId),
          eq(deviceTaskAssignmentEvents.assignmentId, assignment.id),
          eq(deviceTaskAssignmentEvents.eventType, `comment_${input.nextState}`),
          eq(deviceTaskAssignmentEvents.payloadHash, input.payloadHash)
        ))
        .limit(1);
      if (existingEvent) {
        return { action, assignment, event: existingEvent, idempotent: true };
      }
    }
    if (action.stateVersion !== input.expectedActionStateVersion) {
      throw new AssignmentRuntimeError("COMMENT_ACTION_STATE_VERSION_CONFLICT", {
        currentStateVersion: action.stateVersion,
        actionState: action.actionState
      });
    }
    if (!actionTransitions[action.actionState]?.includes(input.nextState)) {
      throw new AssignmentRuntimeError("COMMENT_ACTION_TRANSITION_INVALID", {
        fromState: action.actionState,
        toState: input.nextState
      });
    }
    if (input.nextState === "submitting") {
      await assertCommentRuntimeEnabled(transaction, assignment);
      if (assignment.executionApprovalId) {
        await lockConsumedActionApproval(transaction, assignment, action);
      }
      if (
        !input.permitTokenHash ||
        input.permitTokenHash !== action.permitTokenHash ||
        !action.permitExpiresAt ||
        action.permitExpiresAt.getTime() <= Date.now()
      ) {
        throw new AssignmentRuntimeError("COMMENT_PERMIT_INVALID");
      }
      if (assignment.status !== "RUNNING" || assignment.blockReason) {
        throw new AssignmentRuntimeError("ASSIGNMENT_NOT_COMMENTABLE");
      }
    } else if (input.nextState === "submitted") {
      if (!input.permitTokenHash || input.permitTokenHash !== action.permitTokenHash) {
        throw new AssignmentRuntimeError("COMMENT_PERMIT_INVALID");
      }
    }

    const terminalAssignment = isTerminalAssignmentStatus(assignment.status);
    const nextAssignmentState = input.nextState === "unknown" && !terminalAssignment ? "BLOCKED" : assignment.status;
    const eventSequence = assignment.lastEventSeq + 1;
    const [event] = await transaction
      .insert(deviceTaskAssignmentEvents)
      .values({
        tenantId: config.tenantId,
        assignmentId: assignment.id,
        sequence: eventSequence,
        deviceId: assignment.deviceId,
        targetId: assignment.selectedTargetId,
        featureType: assignment.taskType,
        stage: assignment.currentStage,
        eventType: `comment_${input.nextState}`,
        fromState: assignment.status,
        toState: nextAssignmentState,
        status: input.nextState === "failed" ? "failed" : input.nextState === "skipped" ? "skipped" : "succeeded",
        reasonCode: input.failureReason ?? input.nextState,
        idempotencyKey: `${action.idempotencyKey}:state:${input.expectedActionStateVersion + 1}`,
        payloadHash: input.payloadHash,
        evidenceJson: { actionId: action.id, actionState: input.nextState, ...input.evidence },
        occurredAt: input.occurredAt,
        actor: "mobile",
        createdBy: "mobile_agent",
        updatedBy: "mobile_agent"
      })
      .returning();
    const rawPayload = action.rawPayload && typeof action.rawPayload === "object"
      ? { ...action.rawPayload, lastEvidence: input.evidence }
      : { lastEvidence: input.evidence };
    const [updatedAction] = await transaction
      .update(liveCommentActions)
      .set({
        assignmentEventId: event.id,
        actionState: input.nextState,
        status: input.nextState,
        stateVersion: action.stateVersion + 1,
        failureReason: input.failureReason ?? action.failureReason,
        submittedAt: input.nextState === "submitted" ? input.occurredAt : action.submittedAt,
        sentAt: input.nextState === "sent" ? input.occurredAt : action.sentAt,
        confirmedAt: ["sent", "failed", "skipped"].includes(input.nextState) ? input.occurredAt : action.confirmedAt,
        reportedAt: input.occurredAt,
        rawPayload,
        updatedAt: new Date(),
        updatedBy: "mobile_agent"
      })
      .where(eq(liveCommentActions.id, action.id))
      .returning();
    const [updatedAssignment] = await transaction
      .update(deviceTaskAssignments)
      .set({
        status: nextAssignmentState,
        blockReason: input.nextState === "unknown" && !terminalAssignment ? "comment_unknown" : assignment.blockReason,
        lastEventSeq: eventSequence,
        stateVersion: assignment.stateVersion + 1,
        updatedAt: new Date(),
        updatedBy: "mobile_agent"
      })
      .where(eq(deviceTaskAssignments.id, assignment.id))
      .returning();
    return { action: updatedAction ?? action, assignment: updatedAssignment ?? assignment, event, idempotent: false };
  });
}

export async function hasUnresolvedCommerceCardCommentActions(assignmentId: string) {
  const [action] = await db
    .select({ id: liveCommentActions.id })
    .from(liveCommentActions)
    .where(and(
      eq(liveCommentActions.tenantId, config.tenantId),
      eq(liveCommentActions.assignmentId, assignmentId),
      inArray(liveCommentActions.actionState, ["submitted", "unknown"]),
      isNull(liveCommentActions.deletedAt)
    ))
    .limit(1);
  return Boolean(action);
}

export async function findCommerceCardCommentActionByKey(input: {
  assignmentId: string;
  deviceId: string;
  idempotencyKey: string;
}) {
  const [row] = await db
    .select({ action: liveCommentActions, assignmentDeviceId: deviceTaskAssignments.deviceId })
    .from(liveCommentActions)
    .innerJoin(deviceTaskAssignments, eq(liveCommentActions.assignmentId, deviceTaskAssignments.id))
    .where(and(
      eq(liveCommentActions.tenantId, config.tenantId),
      eq(liveCommentActions.assignmentId, input.assignmentId),
      eq(liveCommentActions.idempotencyKey, input.idempotencyKey),
      eq(deviceTaskAssignments.deviceId, input.deviceId)
    ))
    .limit(1);
  return row?.action ?? null;
}

export async function resolveCommerceCardCommentActionAtomic(input: {
  actionId: string;
  expectedActionStateVersion: number;
  resolution: "sent" | "failed";
  evidence: string;
  actor: string;
  payloadHash: string;
}) {
  return db.transaction(async (transaction) => {
    const [candidateAction] = await transaction
      .select()
      .from(liveCommentActions)
      .where(and(
        eq(liveCommentActions.tenantId, config.tenantId),
        eq(liveCommentActions.id, input.actionId)
      ))
      .limit(1);
    if (!candidateAction?.assignmentId) {
      throw new AssignmentRuntimeError("COMMENT_ACTION_NOT_FOUND");
    }
    const assignment = await lockAssignment(transaction, candidateAction.assignmentId);
    if (!assignment) {
      throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
    }
    const [action] = await transaction
      .select()
      .from(liveCommentActions)
      .where(and(
        eq(liveCommentActions.tenantId, config.tenantId),
        eq(liveCommentActions.id, input.actionId),
        eq(liveCommentActions.assignmentId, assignment.id)
      ))
      .limit(1)
      .for("update");
    if (!action?.actionState) {
      throw new AssignmentRuntimeError("COMMENT_ACTION_NOT_FOUND");
    }
    if (
      action.stateVersion === input.expectedActionStateVersion + 1 &&
      action.actionState === input.resolution &&
      action.assignmentEventId
    ) {
      const [existingEvent] = await transaction
        .select()
        .from(deviceTaskAssignmentEvents)
        .where(and(
          eq(deviceTaskAssignmentEvents.tenantId, config.tenantId),
          eq(deviceTaskAssignmentEvents.id, action.assignmentEventId),
          eq(deviceTaskAssignmentEvents.assignmentId, assignment.id),
          eq(deviceTaskAssignmentEvents.eventType, `comment_resolved_${input.resolution}`),
          eq(deviceTaskAssignmentEvents.payloadHash, input.payloadHash)
        ))
        .limit(1);
      if (existingEvent) {
        return { action, assignment, event: existingEvent, idempotent: true };
      }
    }
    if (action.stateVersion !== input.expectedActionStateVersion) {
      throw new AssignmentRuntimeError("COMMENT_ACTION_STATE_VERSION_CONFLICT", {
        currentStateVersion: action.stateVersion
      });
    }
    if (action.actionState !== "unknown" && action.actionState !== "submitted") {
      throw new AssignmentRuntimeError("COMMENT_ACTION_RESOLUTION_INVALID", { actionState: action.actionState });
    }
    const terminalAssignment = isTerminalAssignmentStatus(assignment.status);
    const nextAssignmentState = terminalAssignment ? assignment.status : "BLOCKED";
    const now = new Date();
    const sequence = assignment.lastEventSeq + 1;
    const [event] = await transaction
      .insert(deviceTaskAssignmentEvents)
      .values({
        tenantId: config.tenantId,
        assignmentId: assignment.id,
        sequence,
        deviceId: assignment.deviceId,
        targetId: assignment.selectedTargetId,
        featureType: assignment.taskType,
        stage: assignment.currentStage,
        eventType: `comment_resolved_${input.resolution}`,
        fromState: assignment.status,
        toState: nextAssignmentState,
        status: input.resolution === "sent" ? "succeeded" : "failed",
        reasonCode: "manual_comment_resolution",
        idempotencyKey: `${action.idempotencyKey}:resolve:${input.expectedActionStateVersion + 1}`,
        payloadHash: input.payloadHash,
        evidenceJson: { actionId: action.id, evidence: input.evidence, resolvedBy: input.actor },
        occurredAt: now,
        actor: "admin",
        createdBy: input.actor,
        updatedBy: input.actor
      })
      .returning();
    const [updatedAction] = await transaction
      .update(liveCommentActions)
      .set({
        assignmentEventId: event.id,
        actionState: input.resolution,
        status: input.resolution,
        stateVersion: action.stateVersion + 1,
        sentAt: input.resolution === "sent" ? action.sentAt ?? now : action.sentAt,
        confirmedAt: now,
        resolvedBy: input.actor,
        resolvedAt: now,
        resolutionEvidence: input.evidence,
        updatedAt: now,
        updatedBy: input.actor
      })
      .where(eq(liveCommentActions.id, action.id))
      .returning();
    const [updatedAssignment] = await transaction
      .update(deviceTaskAssignments)
      .set({
        status: nextAssignmentState,
        blockReason: terminalAssignment ? assignment.blockReason : "comment_resolved_requires_resume",
        lastEventSeq: sequence,
        stateVersion: assignment.stateVersion + 1,
        updatedAt: now,
        updatedBy: input.actor
      })
      .where(eq(deviceTaskAssignments.id, assignment.id))
      .returning();
    return { action: updatedAction ?? action, assignment: updatedAssignment ?? assignment, event, idempotent: false };
  });
}
