import type { ManualPublishTestPayload } from "@pkg/types";
import { mutate, request } from "./api-client";

export type { ManualPublishTestPayload };

export type PublishTaskRow = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  accountName: string;
  deviceCode: string | null;
  platform: string;
  status: string;
  scheduledSlot: string | null;
  resultError: string | null;
  matchNote: string | null;
  publishedUrl: string | null;
  claimedAt: string;
  dispatchedAt: string | null;
  finishedAt: string | null;
  reportedAt: string | null;
  updatedAt: string;
};

export type PublishTaskDashboard = {
  data: PublishTaskRow[];
  stats: {
    success: number;
    unpublished: number;
    unmatched: number;
  };
};

export function getPublishTaskDashboard() {
  return request<PublishTaskDashboard>("/admin/publish-tasks");
}

export function completePublishTaskTopics(id: string, description: string) {
  return mutate<PublishTaskRow>(
    `/admin/publish-tasks/${encodeURIComponent(id)}/topics`,
    { description }
  );
}

export function claimPublishTaskOnce(configId: string) {
  return mutate<{
    claimed: boolean;
    created: boolean;
    task: PublishTaskRow | null;
  }>("/admin/publish-tasks/claim-once", { configId });
}

export function dispatchPublishTasksNow(configId: string) {
  return mutate<{
    configId: string;
    scheduledSlot: string;
    dispatched: number;
    reported: number;
  }>("/admin/publish-tasks/dispatch-now", { configId });
}

export function createManualPublishTest(payload: ManualPublishTestPayload) {
  return mutate<{
    task: PublishTaskRow;
    command: { id: string; commandType: string; status: string };
    idempotent: boolean;
  }>("/admin/publish-tasks/manual-test", payload);
}
