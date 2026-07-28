import { mutate, request } from "./api-client";

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
