export const INTERFACE_PUBLISH_MORNING_WINDOW_TEXT = "06:00-12:00";
export const INTERFACE_PUBLISH_AFTERNOON_WINDOW_TEXT = "13:00-24:00";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MORNING_START = 6 * 60;
const MORNING_END = 12 * 60;
const AFTERNOON_START = 13 * 60;
const AFTERNOON_END = 24 * 60;
const MORNING_PASSED_WARNING = "今日上午发布时间已过，今天只能执行下午发布";

function minutesOfDay(value: string) {
  if (!TIME_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function shanghaiMinuteOfDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function validateInterfacePublishRunTimes(
  morningPublishTime: string,
  afternoonPublishTime: string
) {
  const morning = minutesOfDay(morningPublishTime);
  const afternoon = minutesOfDay(afternoonPublishTime);
  if (
    morning === null
    || afternoon === null
    || morning < MORNING_START
    || morning >= MORNING_END
    || afternoon < AFTERNOON_START
    || afternoon >= AFTERNOON_END
  ) {
    return {
      valid: false as const,
      code: "INVALID_TIME" as const,
      message: "当前输入时间不合法"
    };
  }
  return { valid: true as const };
}

export function assessInterfacePublishManualStart(
  config: { morningPublishTime: string; afternoonPublishTime: string },
  now = new Date()
) {
  const validation = validateInterfacePublishRunTimes(
    config.morningPublishTime,
    config.afternoonPublishTime
  );
  if (!validation.valid) return { ...validation, warnings: [] as string[] };

  const current = shanghaiMinuteOfDay(now);
  const morning = minutesOfDay(config.morningPublishTime)!;
  const afternoon = minutesOfDay(config.afternoonPublishTime)!;
  const warnings = current >= MORNING_END ? [MORNING_PASSED_WARNING] : [];
  if (current < MORNING_END && morning <= current) {
    return {
      valid: false as const,
      code: "RESET_MORNING" as const,
      message: "上午发布时间已过，请重新设置当前时间之后的上午发布时间",
      warnings
    };
  }
  if (afternoon <= current) {
    return {
      valid: false as const,
      code: "RESET_AFTERNOON" as const,
      message: "下午发布时间已过，请设置当前时间之后的发布时间",
      warnings
    };
  }
  return warnings.length
    ? { valid: true as const, code: "MORNING_PASSED" as const, warnings }
    : { valid: true as const, code: "READY" as const, warnings };
}
