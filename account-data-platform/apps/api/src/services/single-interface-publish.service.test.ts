import { beforeEach, describe, expect, test } from "bun:test";
import { createSingleInterfacePublishService } from "./single-interface-publish.service";

function dependencies() {
  return {
    loadBindings: async () => [{
      deviceId: "device-uuid",
      deviceCode: "device_test",
      deviceName: "MI 8",
      deviceStatus: "online",
      accountName: "勤能致富",
      accountNo: "23362504586",
      externalAccountKey: "勤能致富",
      bindingEnabled: true
    }, {
      deviceId: "unrelated-device-uuid",
      deviceCode: "unrelated_device",
      deviceName: "Other phone",
      deviceStatus: "online",
      accountName: "其他账号",
      accountNo: "999999",
      externalAccountKey: "其他账号",
      bindingEnabled: true
    }],
    loadConfig: async () => ({ id: "config-uuid" }),
    fetchTask: async (douyinId: string) => ({
      taskId: "external-task-1",
      accountName: "勤能致富",
      platform: "抖音" as const,
      status: "未发布" as const,
      title: `material-for-${douyinId}`,
      description: "乡村生活 #三农",
      videoUrl: "https://media.example.test/video.mp4",
      coverUrl: "https://media.example.test/cover.jpg"
    }),
    dispatch: async (payload: Record<string, unknown>) => ({
      task: { id: "local-task-1", status: "DISPATCHED", ...payload },
      command: { id: "command-1", status: "PENDING" }
    }),
    inspectCommand: async () => ({ status: "PENDING" }),
    inspectTask: async () => ({ status: "CLAIMED", resultError: null }),
    recover: async () => null,
    cancelPendingCommand: async () => true,
    closeCancelledTask: async () => {},
    createStopCommand: async () => ({ id: "stop-1", status: "PENDING" })
  };
}

describe("single interface publish service", () => {
  beforeEach(() => delete process.env.PUBLISH_EXTERNAL_TOKEN);

  test("starts one existing publish flow using accountNo as douyinId", async () => {
    const deps: any = dependencies();
    let fetchedId = "";
    let dispatched: Record<string, unknown> | undefined;
    deps.fetchTask = async (douyinId: string) => {
      fetchedId = douyinId;
      return dependencies().fetchTask(douyinId);
    };
    deps.dispatch = async (payload: Record<string, unknown>) => {
      dispatched = payload;
      return dependencies().dispatch(payload);
    };
    const service = createSingleInterfacePublishService(deps);

    const result = await service.start("root");

    expect(fetchedId).toBe("23362504586");
    expect(dispatched).toMatchObject({
      configId: "config-uuid",
      deviceId: "device-uuid",
      platform: "抖音",
      title: "material-for-23362504586"
    });
    expect(result).toMatchObject({
      status: "RUNNING",
      externalTaskId: "external-task-1",
      taskId: "local-task-1",
      deviceCode: "device_test",
      accountName: "勤能致富",
      douyinId: "23362504586"
    });
    expect(result.runId).toBeString();
  });

  test("does not create a local task when the account has no material", async () => {
    const deps: any = dependencies();
    deps.fetchTask = async () => null;
    let dispatched = false;
    deps.dispatch = async (payload: Record<string, unknown>) => {
      dispatched = true;
      return dependencies().dispatch(payload);
    };
    const service = createSingleInterfacePublishService(deps);

    await expect(service.start("root")).rejects.toMatchObject({ message: "NO_UNPUBLISHED_MATERIAL" });
    expect(dispatched).toBeFalse();
  });

  test("cancels a publish command that the phone has not fetched", async () => {
    const deps: any = dependencies();
    const service = createSingleInterfacePublishService(deps);
    await service.start("root");

    const stopped = await service.stop("root");

    expect(stopped).toMatchObject({ status: "STOPPED", stopMode: "CANCELLED_BEFORE_FETCH", bestEffort: false });
  });

  test("issues a dedicated targeted STOP after the phone fetched the publish command", async () => {
    const deps: any = dependencies();
    deps.inspectCommand = async () => ({ status: "FETCHED" });
    let stopRun: Record<string, unknown> | undefined;
    deps.createStopCommand = async (run: Record<string, unknown>) => {
      stopRun = run;
      return { id: "stop-1", status: "PENDING" };
    };
    const service = createSingleInterfacePublishService(deps);
    await service.start("root");

    const stopped = await service.stop("root");

    expect(stopped).toMatchObject({ status: "STOPPING", stopMode: "DEDICATED_STOP", bestEffort: false });
    expect(stopRun).toMatchObject({ runId: expect.any(String), taskId: "local-task-1", externalTaskId: "external-task-1", commandId: "command-1" });
  });

  test("projects STOPPED after the dedicated stop command is acknowledged", async () => {
    const deps: any = dependencies();
    deps.inspectCommand = async (commandId: string) => ({
      status: commandId === "stop-1" ? "DONE" : "FETCHED"
    });
    const service = createSingleInterfacePublishService(deps);
    await service.start("root");
    await service.stop("root");

    expect(await service.current()).toMatchObject({
      status: "STOPPED",
      stopMode: "DEDICATED_STOP",
      stopCommandId: "stop-1"
    });
  });

  test("projects the mature publish result without changing its result flow", async () => {
    const deps: any = dependencies();
    deps.inspectTask = async () => ({ status: "SUCCEEDED", resultError: null });
    const service = createSingleInterfacePublishService(deps);
    await service.start("root");

    expect(await service.current()).toMatchObject({ status: "SUCCEEDED", taskId: "local-task-1" });
  });

  test("rejects a second start while the current run is active", async () => {
    const service = createSingleInterfacePublishService(dependencies() as any);
    await service.start("root");
    await expect(service.start("root")).rejects.toMatchObject({ message: "RUN_ALREADY_ACTIVE" });
  });

  test("recovers the latest dedicated run after service restart", async () => {
    const deps: any = dependencies();
    deps.recover = async () => ({
      task: {
        id: "recovered-task",
        matchedDeviceId: "device-uuid",
        accountName: "勤能致富",
        title: "recovered material",
        status: "CLAIMED",
        resultError: null,
        rawPayload: { runId: "run-recovered", taskId: "external-recovered", deviceCode: "device_test", deviceStatus: "online", douyinId: "23362504586" },
        updatedAt: new Date("2026-08-07T10:00:00.000Z")
      },
      publishCommand: { id: "publish-recovered", status: "FETCHED", payloadJson: { runId: "run-recovered" } },
      stopCommand: null
    });
    const service = createSingleInterfacePublishService(deps);

    expect(await service.current()).toMatchObject({
      status: "RUNNING",
      taskId: "recovered-task",
      externalTaskId: "external-recovered",
      deviceStatus: "online",
      updatedAt: "2026-08-07T10:00:00.000Z"
    });
  });

  test("does not remain STOPPING when the dedicated stop command is ignored", async () => {
    const deps: any = dependencies();
    deps.inspectCommand = async (id: string) => ({ status: id === "stop-1" ? "IGNORED" : "FETCHED" });
    deps.inspectTask = async () => ({ status: "SUCCEEDED", resultError: null });
    const service = createSingleInterfacePublishService(deps);
    await service.start("root");
    await service.stop("root");

    expect(await service.current()).toMatchObject({ status: "SUCCEEDED", error: null });
  });
});
