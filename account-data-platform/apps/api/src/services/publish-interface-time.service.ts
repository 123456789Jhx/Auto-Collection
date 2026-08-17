import type { InterfacePublishRunConfig, InterfacePublishSlot } from "@pkg/types";

export type InterfacePublishBusinessClock = {
  businessDate: string;
  minuteOfDay: number;
};

export function resolveBusinessClock(
  now: Date,
  timezone: "Asia/Shanghai" = "Asia/Shanghai"
): InterfacePublishBusinessClock {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
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

function minuteFromTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function resolveDueSlots(
  config: InterfacePublishRunConfig,
  now: Date
): InterfacePublishSlot[] {
  const { minuteOfDay } = resolveBusinessClock(now, config.timezone);
  if (
    minuteOfDay >= 6 * 60
    && minuteOfDay < 12 * 60
    && minuteOfDay >= minuteFromTime(config.morningPublishTime)
  ) {
    return ["MORNING"];
  }
  if (
    minuteOfDay >= 13 * 60
    && minuteOfDay < 24 * 60
    && minuteOfDay >= minuteFromTime(config.afternoonPublishTime)
  ) {
    return ["AFTERNOON"];
  }
  return [];
}

export function isInterfacePublishWindowExpired(
  slot: InterfacePublishSlot,
  businessDate: string,
  now: Date
) {
  const clock = resolveBusinessClock(now);
  if (clock.businessDate > businessDate) return true;
  if (clock.businessDate < businessDate) return false;
  return clock.minuteOfDay >= (slot === "MORNING" ? 12 * 60 : 24 * 60);
}
