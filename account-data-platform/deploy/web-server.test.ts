import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebRequestHandler } from "./web-server";

const tempRoots: string[] = [];

async function createPublicRoot() {
  const root = await mkdtemp(join(tmpdir(), "auto-collection-web-"));
  tempRoots.push(root);
  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, "downloads"), { recursive: true });
  await writeFile(join(root, "index.html"), "<main>app shell</main>");
  await writeFile(join(root, "assets", "index.js"), "console.log('ok');");
  await writeFile(join(root, "downloads", "agent.zip"), "package");
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("production web server", () => {
  test("proxies API and readiness endpoints to the API service", async () => {
    const publicRoot = await createPublicRoot();
    const upstreamUrls: string[] = [];
    const handler = createWebRequestHandler({
      apiOrigin: "http://api:8080",
      publicRoot,
      fetchImpl: async (input) => {
        upstreamUrls.push(String(input));
        return new Response("proxied", { status: 202 });
      },
    });

    const apiResponse = await handler(new Request("http://web/api/v1/devices?limit=10"));
    const healthResponse = await handler(new Request("http://web/health"));
    const readyResponse = await handler(new Request("http://web/ready"));

    expect(await apiResponse.text()).toBe("proxied");
    expect(apiResponse.status).toBe(202);
    expect(await healthResponse.text()).toBe("proxied");
    expect(await readyResponse.text()).toBe("proxied");
    expect(upstreamUrls).toEqual([
      "http://api:8080/api/v1/devices?limit=10",
      "http://api:8080/health",
      "http://api:8080/ready",
    ]);
  });

  test("serves static assets, download files, and SPA fallback without path traversal", async () => {
    const publicRoot = await createPublicRoot();
    const handler = createWebRequestHandler({ apiOrigin: "http://api:8080", publicRoot });

    const assetResponse = await handler(new Request("http://web/assets/index.js"));
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toContain("console.log");

    const downloadResponse = await handler(new Request("http://web/downloads/agent.zip"));
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("cache-control")).toBe("no-store");
    expect(await downloadResponse.text()).toBe("package");

    const fallbackResponse = await handler(new Request("http://web/task-scheduler"));
    expect(fallbackResponse.status).toBe(200);
    expect(await fallbackResponse.text()).toContain("app shell");

    const traversalResponse = await handler(new Request("http://web/%2e%2e/package.json"));
    expect(traversalResponse.status).toBe(404);
  });
});
