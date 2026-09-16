import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as repository from "../repositories/biz-script-workspace.repository";
import { listBizScriptDevices } from "./biz-script-delivery.service";
import { createBizScriptWorkspaceService } from "./biz-script-workspace.service";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
export const bizScriptWorkspaceService = createBizScriptWorkspaceService({
  ...repository,
  readBaseline: async () => {
    const path = process.env.BIZ_SCRIPT_BASELINE_MANIFEST
      ? resolve(process.env.BIZ_SCRIPT_BASELINE_MANIFEST)
      : join(repositoryRoot, "dist", "apk", "biz-script-baseline.json");
    return JSON.parse(await readFile(path, "utf8"));
  },
  listDevices: listBizScriptDevices
});
