import { expect, test } from "bun:test";

const schedulerSource = await Bun.file(new URL("./publish-scheduler.service.ts", import.meta.url)).text();
const routesSource = await Bun.file(new URL("../routes/publish-tasks.ts", import.meta.url)).text();

test("scheduler does not use legacy publishTimeSlots to claim external tasks", () => {
  expect(schedulerSource).not.toContain("publishTimeSlots.includes");
  expect(schedulerSource).not.toContain("dispatchPublishConfigNow(savedConfig.id");
  expect(routesSource).not.toContain('post("/claim-once"');
  expect(routesSource).not.toContain('post("/dispatch-now"');
});
