import {
  publishRunBindings,
  publishSlotExecutions,
  publishTasks
} from "@pkg/db/schema";
import {
  resolvePublishMaterialUrls,
  type ResolvedPublishMaterial
} from "@pkg/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../repositories/db";
import {
  createPublishVideoTaskCommand,
  type PublishCommandConfig
} from "./publish-command.service";
import { normalizeExternalPublishMaterial } from "./publish-material.service";

type DispatchDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PublishInterfaceDispatchTask = {
  id: string;
  matchedDeviceId: string | null;
  platform: string;
  title: string;
  description: string;
  videoUrl: string;
  coverUrl: string | null;
  rawPayload: Record<string, unknown> | null;
};

export type PublishInterfaceDispatchStore = {
  database?: DispatchDatabase;
  loadTask: (publishTaskId: string) => Promise<PublishInterfaceDispatchTask | null>;
  saveResolvedMaterial: (
    publishTaskId: string,
    material: ResolvedPublishMaterial,
    matchedDeviceId: string,
    actor: string
  ) => Promise<PublishInterfaceDispatchTask>;
  markDispatched: (publishTaskId: string, dispatchedAt: Date, actor: string) => Promise<void>;
};

type DispatchDependencies = {
  transaction?: <T>(work: (store: PublishInterfaceDispatchStore) => Promise<T>) => Promise<T>;
  createCommand?: (
    task: PublishInterfaceDispatchTask,
    commandConfig: PublishCommandConfig,
    actor: string,
    store: PublishInterfaceDispatchStore
  ) => Promise<{ command: { id: string }; idempotent: boolean }>;
  now?: () => Date;
};

function storeFor(database: DispatchDatabase): PublishInterfaceDispatchStore {
  return {
    database,
    async loadTask(publishTaskId) {
      const [row] = await database.select({
        id: publishTasks.id,
        matchedDeviceId: sql<string | null>`coalesce(${publishTasks.matchedDeviceId}, ${publishRunBindings.deviceId})`,
        platform: publishTasks.platform,
        title: publishTasks.title,
        description: publishTasks.description,
        videoUrl: publishTasks.videoUrl,
        coverUrl: publishTasks.coverUrl,
        rawPayload: publishTasks.rawPayload
      }).from(publishTasks)
        .leftJoin(publishSlotExecutions, and(
          eq(publishSlotExecutions.id, publishTasks.slotExecutionId),
          eq(publishSlotExecutions.tenantId, config.tenantId),
          isNull(publishSlotExecutions.deletedAt)
        ))
        .leftJoin(publishRunBindings, and(
          eq(publishRunBindings.runId, publishSlotExecutions.runId),
          eq(publishRunBindings.bindingId, publishSlotExecutions.bindingId),
          eq(publishRunBindings.tenantId, config.tenantId),
          isNull(publishRunBindings.deletedAt)
        ))
        .where(and(
          eq(publishTasks.tenantId, config.tenantId),
          eq(publishTasks.id, publishTaskId),
          isNull(publishTasks.deletedAt)
        ))
        .limit(1);
      return row ?? null;
    },

    async saveResolvedMaterial(publishTaskId, material, matchedDeviceId, actor) {
      const trace = JSON.stringify({ materialTrace: material });
      const [updated] = await database.update(publishTasks).set({
        videoUrl: material.videoUrl,
        coverUrl: material.coverUrl,
        matchedDeviceId,
        rawPayload: sql`coalesce(${publishTasks.rawPayload}, '{}'::jsonb) || ${trace}::jsonb`,
        updatedAt: new Date(),
        updatedBy: actor
      }).where(and(
        eq(publishTasks.tenantId, config.tenantId),
        eq(publishTasks.id, publishTaskId),
        isNull(publishTasks.deletedAt)
      )).returning();
      if (!updated) throw new Error("INTERFACE_PUBLISH_TASK_NOT_FOUND");
      return {
        id: updated.id,
        matchedDeviceId: updated.matchedDeviceId,
        platform: updated.platform,
        title: updated.title,
        description: updated.description,
        videoUrl: updated.videoUrl,
        coverUrl: updated.coverUrl,
        rawPayload: updated.rawPayload
      };
    },

    async markDispatched(publishTaskId, dispatchedAt, actor) {
      const [updated] = await database.update(publishTasks).set({
        status: "DISPATCHED",
        dispatchedAt,
        updatedAt: dispatchedAt,
        updatedBy: actor
      }).where(and(
        eq(publishTasks.tenantId, config.tenantId),
        eq(publishTasks.id, publishTaskId),
        isNull(publishTasks.deletedAt)
      )).returning({ slotExecutionId: publishTasks.slotExecutionId });
      if (!updated) throw new Error("INTERFACE_PUBLISH_TASK_NOT_FOUND");
      if (updated.slotExecutionId) {
        await database.update(publishSlotExecutions).set({
          status: "DISPATCHED",
          updatedAt: dispatchedAt,
          updatedBy: actor
        }).where(and(
          eq(publishSlotExecutions.tenantId, config.tenantId),
          eq(publishSlotExecutions.id, updated.slotExecutionId),
          isNull(publishSlotExecutions.deletedAt)
        ));
      }
    }
  };
}

export function createPublishInterfaceDispatchService(dependencies: DispatchDependencies = {}) {
  const transaction = dependencies.transaction
    ?? (<T>(work: (store: PublishInterfaceDispatchStore) => Promise<T>) =>
      db.transaction((database) => work(storeFor(database))));
  const createCommand = dependencies.createCommand
    ?? ((task, commandConfig, actor, store) =>
      createPublishVideoTaskCommand(task, commandConfig, actor, store.database));
  const now = dependencies.now ?? (() => new Date());

  return {
    dispatch(input: {
      publishTaskId: string;
      allowedHosts: readonly string[];
      commandConfig: PublishCommandConfig;
      actor: string;
    }) {
      return transaction(async (store) => {
        const task = await store.loadTask(input.publishTaskId);
        if (!task) throw new Error("INTERFACE_PUBLISH_TASK_NOT_FOUND");
        if (!task.matchedDeviceId) throw new Error("INTERFACE_PUBLISH_DEVICE_NOT_RESERVED");
        const validation = normalizeExternalPublishMaterial(task, {
          allowedHosts: input.allowedHosts
        });
        if (!validation.valid) {
          throw new Error(`PUBLISH_TASK_MATERIAL_INVALID:${validation.code}`);
        }
        const resolution = resolvePublishMaterialUrls(task);
        if (!resolution.valid) {
          throw new Error(`PUBLISH_TASK_MATERIAL_INVALID:${resolution.code}`);
        }
        const saved = await store.saveResolvedMaterial(
          task.id,
          resolution.material,
          task.matchedDeviceId,
          input.actor
        );
        const command = await createCommand(saved, input.commandConfig, input.actor, store);
        await store.markDispatched(task.id, now(), input.actor);
        return {
          publishTaskId: task.id,
          commandId: command.command.id,
          idempotent: command.idempotent
        };
      });
    }
  };
}

export const publishInterfaceDispatchService = createPublishInterfaceDispatchService();
