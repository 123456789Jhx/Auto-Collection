import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UpdateCenterPage } from "../src/routes/UpdateCenterPage";
import { bizScriptWorkspaceKey, bizScriptPreviewsKey, bizScriptDevicesKey } from "../src/lib/api-client-biz-script-workspace";
import { bizScriptUploadLimits } from "@pkg/types";

function renderPage(workspace) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (workspace) client.setQueryData(bizScriptWorkspaceKey, workspace);
  client.setQueryData(bizScriptPreviewsKey, { data: [] });
  client.setQueryData(bizScriptDevicesKey, { data: [] });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(App, null, createElement(UpdateCenterPage))));
  client.clear();
  return html;
}

test("workspace without a confirmed baseline disables folder publication and retains APK tab", () => {
  const html = renderPage({ ready: false, reason: "尚无已确认 APK 基线", baseline: null, limits: bizScriptUploadLimits });
  expect(html).toContain("尚无已确认 APK 基线");
  expect(html).toContain("选择脚本目录");
  expect(html).toContain("生成预览");
  expect(html).toMatch(/<button[^>]*disabled[^>]*>.*?生成预览/s);
  expect(html).toContain("APK 基座");
  expect(html).not.toContain("一键构建并发布当前业务脚本");
  expect(html).not.toContain("指定文件增量包");
});

test("workspace loading has an explicit baseline state", () => {
  const html = renderPage();
  expect(html).toContain("正在读取 APK 基线");
  expect(html).not.toContain("暂无设备更新上报");
});
