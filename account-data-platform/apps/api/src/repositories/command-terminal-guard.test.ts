import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("terminal command updates cannot overwrite an existing terminal result", () => {
  const source = readFileSync(fileURLToPath(new URL("./command.repository.ts", import.meta.url)), "utf8");
  expect(source).toContain('inArray(mobileCommands.status, ["PENDING", "FETCHED", "CLAIMED", "RUNNING"])');
  expect(source).toContain("terminalGuard");
});
