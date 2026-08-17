import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { app } from "../app";
import { config } from "../config";

const suffix = crypto.randomUUID().slice(0, 8);
const files = [
  { name: `n5-emergency-${suffix}.mp4`, type: "video/mp4", body: "video-bytes" },
  { name: `n5-emergency-${suffix}.jpg`, type: "image/jpeg", body: "image-bytes" },
  { name: `n5-agent-${suffix}.apk`, type: "application/vnd.android.package-archive", body: "apk-bytes" }
];
const root = resolve(process.cwd(), config.agentDownloadDir);

beforeAll(async () => {
  await mkdir(root, { recursive: true });
  await Promise.all(files.map((file) => writeFile(resolve(root, file.name), file.body)));
});

afterAll(async () => {
  await Promise.all(files.map((file) => rm(resolve(root, file.name), { force: true })));
});

describe("agent material downloads", () => {
  for (const file of files) {
    test(`serves ${file.name.split(".").at(-1)} test material`, async () => {
      const response = await app.request(`/downloads/agent/${file.name}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(file.type);
      expect(await response.text()).toBe(file.body);
    });
  }
});
