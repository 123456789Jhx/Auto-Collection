import type { InterfacePublishRunConfig } from "@pkg/types";

type ManualRunStartSuccess = {
  valid: true;
  businessDate: string;
  morning: "WAITING" | "MISSED";
  afternoon: "WAITING";
};

type ManualRunStartFailure = {
  valid: false;
  businessDate: string;
  code: "MORNING_PUBLISH_TIME_PASSED" | "AFTERNOON_PUBLISH_TIME_PASSED";
  message: string;
};

export type ManualRunStartValidation = ManualRunStartSuccess | ManualRunStartFailure;

function shanghaiClock(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const values = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value])
  );
  return {
    businessDate: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute)
  };
}

export function businessDateInShanghai(now: Date) {
  return shanghaiClock(now).businessDate;
}

function configuredMinute(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function validateManualRunStart(
  config: InterfacePublishRunConfig,
  now: Date
): ManualRunStartValidation {
  const clock = shanghaiClock(now);
  const morningPublishMinute = configuredMinute(config.morningPublishTime);
  const afternoonPublishMinute = configuredMinute(config.afternoonPublishTime);

  if (clock.minuteOfDay < 12 * 60 && morningPublishMinute < clock.minuteOfDay) {
    return {
      valid: false,
      businessDate: clock.businessDate,
      code: "MORNING_PUBLISH_TIME_PASSED",
      message: "请重新设置晚于当前时间且早于 12:00 的上午发布时间"
    };
  }

  if (afternoonPublishMinute < clock.minuteOfDay) {
    return {
      valid: false,
      businessDate: clock.businessDate,
      code: "AFTERNOON_PUBLISH_TIME_PASSED",
      message: "请重新设置晚于当前时间且早于次日 00:00 的下午发布时间"
    };
  }

  return {
    valid: true,
    businessDate: clock.businessDate,
    morning: clock.minuteOfDay >= 12 * 60 ? "MISSED" : "WAITING",
    afternoon: "WAITING"
  };
}
