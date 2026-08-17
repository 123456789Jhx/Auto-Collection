import { describe, expect, test } from "bun:test";
import type { ClaimedWecomPublishTask } from "@pkg/types";
import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { adminRoutes } from "../routes/admin";
import { mobilePublishTaskRoutes } from "../routes/mobile-publish-tasks";
import {
  claimInterfacePublishTask,
  patchTaskStatus,
  type WecomPublishClientLog
} from "../services/wecom-publish-client";
import { createInterfacePublishMockServer } from "../test-support/interface-publish-mock-server";

const apiRoot = path.resolve(import.meta.dir, "..");
const workspaceRoot = path.resolve(apiRoot, "../../..");
const webSourceRoot = path.join(workspaceRoot, "apps/web/src");
const mobileRoot = path.resolve(workspaceRoot, "../mobile-agent/autojs");
const fakeToken = "node19-security-fake-token";
const securityAccountName = "安全测试账号";
const realExternalHost = ["wecom", "dafengchan", "top"].join(".");
const realTestAccountName = ["开心", "幸福", "一家人"].join("");
const realTestAccountNo = ["41218", "954470"].join("");
const tokenEnv = `NODE19_SECURITY_TOKEN_${crypto.randomUUID().replaceAll("-", "")}`;
const clientConfig = { externalBaseUrl: "https://mock.security.test", externalTokenEnv: tokenEnv };

function walkFiles(root: string, extensions: Set<string>) {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (["dist", "node_modules", ".git", "tests"].includes(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(target, extensions));
    else if (extensions.has(path.extname(entry.name))) result.push(target);
  }
  return result;
}

function sourceText(root: string, extensions: string[]) {
  return walkFiles(root, new Set(extensions))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

function mockFetch(server: ReturnType<typeof createInterfacePublishMockServer>) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    await server.app.request(input, init);
}

describe("interface publish security integration", () => {
  test("all interface-publish admin route groups reject requests without admin auth", async () => {
    const app = new Hono();
    app.route("/admin", adminRoutes);
    for (const route of [
      "/admin/interface-publish/bindings",
      "/admin/interface-publish/runs",
      "/admin/interface-publish/monitor"
    ]) {
      const response = await app.request(route);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "ADMIN_AUTH_REQUIRED" } });
    }
  });

  test("mobile publish result route rejects requests before the result reporter without mobile auth", async () => {
    const app = new Hono();
    app.route("/mobile/publish-tasks", mobilePublishTaskRoutes);
    const response = await app.request("/mobile/publish-tasks/task-without-auth/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "PUBLISHED" })
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "DEVICE_ID_REQUIRED" } });
  });

  test("claim and PATCH logs omit Token, Authorization and complete material payload", async () => {
    process.env[tokenEnv] = fakeToken;
    const task: ClaimedWecomPublishTask = {
      taskId: "security-task",
      accountName: securityAccountName,
      title: "不得进入日志的完整标题",
      description: "不得进入日志的完整描述",
      coverUrl: "https://media.example.test/private-cover.jpg?signature=secret",
      videoUrl: "https://media.example.test/private-video.mp4?signature=secret",
      platform: "抖音",
      status: "待发布"
    };
    const server = createInterfacePublishMockServer({
      queues: { [securityAccountName]: [task] },
      token: fakeToken
    });
    const logs: WecomPublishClientLog[] = [];
    try {
      expect(await claimInterfacePublishTask(clientConfig, securityAccountName, {
        fetch: mockFetch(server),
        logger: (entry) => { logs.push(entry); }
      })).toMatchObject({ kind: "CLAIMED" });
      await patchTaskStatus(clientConfig, task.taskId, {
        platform: "抖音",
        status: "已发布",
        publishedUrl: "https://douyin.example.test/video/security"
      }, {
        fetch: mockFetch(server),
        logger: (entry) => { logs.push(entry); }
      });
    } finally {
      delete process.env[tokenEnv];
    }

    const serialized = JSON.stringify(logs);
    for (const forbidden of [
      fakeToken,
      "Authorization",
      task.title,
      task.description,
      "signature=secret",
      task.videoUrl,
      task.coverUrl
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(server.state.patches).toHaveLength(1);
  });

  test("frontend and phone sources contain no real external host, Token value or external endpoint", () => {
    const clientSources = `${sourceText(webSourceRoot, [".ts", ".tsx", ".js"])}\n${sourceText(mobileRoot, [".js"] )}`;
    for (const forbidden of [
      realExternalHost,
      "/api/v1/external/publish-tasks/claim",
      "/api/v1/external/publish-tasks/",
      fakeToken
    ]) {
      expect(clientSources).not.toContain(forbidden);
    }
    expect(clientSources).not.toMatch(/ext_[0-9a-f]{32,}/i);
  });

  test("node 19 automation assets can only target local mock hosts", () => {
    const node19Files = fs.readdirSync(import.meta.dir)
      .filter((name) => name.startsWith("interface-publish-") && name.endsWith(".test.ts"))
      .map((name) => fs.readFileSync(path.join(import.meta.dir, name), "utf8"))
      .join("\n");
    expect(node19Files).not.toContain(realExternalHost);
    expect(node19Files).not.toMatch(/ext_[0-9a-f]{32,}/i);
    expect(node19Files).not.toContain(realTestAccountName);
    expect(node19Files).not.toContain(realTestAccountNo);
  });
});
