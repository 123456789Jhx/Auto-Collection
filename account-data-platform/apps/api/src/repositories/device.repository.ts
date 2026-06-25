import { collectorDevices } from "@pkg/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export async function findDeviceByCode(deviceCode: string) {
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .limit(1);
  return device ?? null;
}

export async function findDeviceByToken(deviceToken: string) {
  if (!deviceToken) return null;
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceToken, deviceToken), isNull(collectorDevices.deletedAt)))
    .limit(1);
  return device ?? null;
}

export async function updateDeviceRuntimeMetadata(deviceId: string, values: {
  platform?: string;
  appVersion?: string;
  lastIp?: string;
}) {
  const [existing] = await db.select().from(collectorDevices).where(eq(collectorDevices.id, deviceId)).limit(1);
  if (!existing) {
    return null;
  }

  const [updated] = await db
    .update(collectorDevices)
    .set({
      platform: values.platform ?? existing.platform,
      appVersion: values.appVersion ?? existing.appVersion,
      lastIp: values.lastIp ?? existing.lastIp,
      updatedAt: new Date()
    })
    .where(eq(collectorDevices.id, existing.id))
    .returning();
  return updated ?? null;
}

export async function resolveDeviceByToken(values: {
  deviceToken: string;
  platform?: string;
  appVersion?: string;
  lastIp?: string;
  expectedDeviceCode?: string;
}) {
  const device = await findDeviceByToken(values.deviceToken);
  if (!device) {
    throw new Error("DEVICE_UNREGISTERED");
  }
  if (!device.enabled) {
    throw new Error("DEVICE_DISABLED");
  }
  if (values.expectedDeviceCode && device.deviceCode !== values.expectedDeviceCode) {
    throw new Error("DEVICE_TOKEN_MISMATCH");
  }
  return (await updateDeviceRuntimeMetadata(device.id, values)) ?? device;
}

export async function upsertDevice(deviceCode: string, platform?: string, appVersion?: string, lastIp?: string) {
  const [existing] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(collectorDevices)
      .set({ platform: platform ?? existing.platform, appVersion: appVersion ?? existing.appVersion, lastIp: lastIp ?? existing.lastIp, updatedAt: new Date() })
      .where(eq(collectorDevices.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(collectorDevices)
    .values({
      tenantId: config.tenantId,
      deviceCode,
      deviceName: deviceCode,
      platform,
      appVersion,
      lastIp,
      status: "offline"
    })
    .returning();
  return created;
}

function tokenSuffix(deviceToken: string, length = 10) {
  return deviceToken.replace(/[^a-zA-Z0-9]/g, "").slice(0, length).toLowerCase() || "unknown";
}

function stableIndex(value: string, size: number) {
  const source = value || "device";
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % size;
}

function defaultAccountProfile(deviceCode: string) {
  const profiles = [
    {
      profileName: "桂北水稻种植户",
      region: { province: "广西", city: "桂林", county: "全州", villageStyle: "丘陵水田" },
      identity: { role: "种植户", years: 8, ageRange: "35-45", tone: "朴实、自然、懂田间管理" },
      products: [{ name: "水稻", scale: "几十亩", season: "早稻/晚稻", topics: ["育秧", "病虫害", "水肥管理"] }],
      interests: ["水稻病虫害", "农机", "肥料使用", "增产经验"]
    },
    {
      profileName: "鲁中大棚蔬菜种植户",
      region: { province: "山东", city: "潍坊", county: "寿光", villageStyle: "设施农业区" },
      identity: { role: "蔬菜种植户", years: 10, ageRange: "35-50", tone: "务实、爱交流种植细节" },
      products: [{ name: "大棚蔬菜", scale: "多个棚", season: "全年轮作", topics: ["控温", "病害", "水肥一体化"] }],
      interests: ["大棚管理", "蔬菜病害", "肥水管理", "行情"]
    },
    {
      profileName: "豫东小麦玉米种植户",
      region: { province: "河南", city: "周口", county: "太康", villageStyle: "平原粮食区" },
      identity: { role: "种植户", years: 12, ageRange: "40-55", tone: "直接、接地气、关心产量" },
      products: [{ name: "小麦/玉米", scale: "百亩左右", season: "麦玉轮作", topics: ["除草", "追肥", "收割"] }],
      interests: ["小麦管理", "玉米高产", "除草剂", "农机"]
    },
    {
      profileName: "川西果园种植户",
      region: { province: "四川", city: "眉山", county: "丹棱", villageStyle: "果园产区" },
      identity: { role: "果农", years: 7, ageRange: "30-45", tone: "温和、喜欢问经验" },
      products: [{ name: "柑橘", scale: "几十亩果园", season: "秋冬采收", topics: ["修剪", "病虫害", "膨果"] }],
      interests: ["果树修剪", "病虫害", "水肥", "品质提升"]
    },
    {
      profileName: "黑龙江大豆玉米种植户",
      region: { province: "黑龙江", city: "绥化", county: "海伦", villageStyle: "东北旱田区" },
      identity: { role: "种植户", years: 9, ageRange: "35-50", tone: "爽快、关注机械化和天气" },
      products: [{ name: "大豆/玉米", scale: "几百亩", season: "春播秋收", topics: ["播种", "除草", "机械收获"] }],
      interests: ["大豆种植", "玉米管理", "农机", "天气"]
    }
  ];
  return {
    ...profiles[stableIndex(deviceCode, profiles.length)],
    speakingStyle: {
      length: "short",
      emojiAllowed: false,
      questionRatio: 0.4
    },
    forbiddenClaims: ["夸大收益", "保证效果", "诱导私信", "售卖农资", "卖课"],
    status: "enabled",
    generatedBy: "system_default",
    generatedAt: new Date().toISOString()
  };
}

async function allocateDeviceCode(preferredCode: string, deviceToken: string) {
  const normalized = (preferredCode || "").trim();
  if (normalized) {
    const existing = await findDeviceByCode(normalized);
    if (!existing) {
      return normalized;
    }
  }

  const suffix = tokenSuffix(deviceToken, 12);
  const generated = "device_" + suffix;
  const generatedExisting = await findDeviceByCode(generated);
  if (!generatedExisting) {
    return generated;
  }

  for (let index = 2; index <= 99; index += 1) {
    const candidate = generated + "_" + index;
    const candidateExisting = await findDeviceByCode(candidate);
    if (!candidateExisting) {
      return candidate;
    }
  }

  return "device_" + Date.now();
}

export async function upsertDeviceByToken(values: {
  deviceToken: string;
  preferredDeviceCode?: string;
  platform?: string;
  appVersion?: string;
  lastIp?: string;
  deviceName?: string;
}) {
  const existingByToken = await findDeviceByToken(values.deviceToken);
  if (existingByToken) {
    const [updated] = await db
      .update(collectorDevices)
      .set({
        platform: values.platform ?? existingByToken.platform,
        appVersion: values.appVersion ?? existingByToken.appVersion,
        lastIp: values.lastIp ?? existingByToken.lastIp,
        updatedAt: new Date()
      })
      .where(eq(collectorDevices.id, existingByToken.id))
      .returning();
    return updated;
  }

  const deviceCode = await allocateDeviceCode(values.preferredDeviceCode || "", values.deviceToken);
  const suffix = tokenSuffix(values.deviceToken, 8);
  const [created] = await db
    .insert(collectorDevices)
    .values({
      tenantId: config.tenantId,
      deviceCode,
      deviceName: values.deviceName || "设备-" + suffix,
      deviceToken: values.deviceToken,
      platform: values.platform,
      appVersion: values.appVersion,
      lastIp: values.lastIp,
      accountProfile: defaultAccountProfile(deviceCode),
      status: "offline",
      remark: "registered: " + new Date().toISOString()
    })
    .returning();
  return created;
}

export async function registerDeviceByToken(values: {
  deviceToken: string;
  preferredDeviceCode?: string;
  platform?: string;
  appVersion?: string;
  lastIp?: string;
  deviceName?: string;
  reactivateDisabled?: boolean;
}) {
  const existingByToken = await findDeviceByToken(values.deviceToken);
  if (existingByToken) {
    if (!existingByToken.enabled && !values.reactivateDisabled) {
      throw new Error("DEVICE_DISABLED");
    }
    const preferredCode = (values.preferredDeviceCode || "").trim();
    if (preferredCode && existingByToken.deviceCode !== preferredCode) {
      throw new Error("DEVICE_CODE_MISMATCH");
    }
    if (!existingByToken.enabled && values.reactivateDisabled) {
      const [updated] = await db
        .update(collectorDevices)
        .set({
          enabled: true,
          platform: values.platform ?? existingByToken.platform,
          appVersion: values.appVersion ?? existingByToken.appVersion,
          lastIp: values.lastIp ?? existingByToken.lastIp,
          updatedAt: new Date()
        })
        .where(eq(collectorDevices.id, existingByToken.id))
        .returning();
      return updated ?? existingByToken;
    }
    return (await updateDeviceRuntimeMetadata(existingByToken.id, values)) ?? existingByToken;
  }

  const preferredCode = (values.preferredDeviceCode || "").trim();
  if (preferredCode) {
    const existingByCode = await findDeviceByCode(preferredCode);
    if (existingByCode) {
      if (!existingByCode.enabled && !values.reactivateDisabled) {
        throw new Error("DEVICE_DISABLED");
      }
      const [updated] = await db
        .update(collectorDevices)
        .set({
          deviceToken: values.deviceToken,
          enabled: existingByCode.enabled || values.reactivateDisabled ? true : existingByCode.enabled,
          platform: values.platform ?? existingByCode.platform,
          appVersion: values.appVersion ?? existingByCode.appVersion,
          lastIp: values.lastIp ?? existingByCode.lastIp,
          updatedAt: new Date()
        })
        .where(eq(collectorDevices.id, existingByCode.id))
        .returning();
      return updated;
    }
  }

  const deviceCode = await allocateDeviceCode(preferredCode, values.deviceToken);
  const suffix = tokenSuffix(values.deviceToken, 8);
  const [created] = await db
    .insert(collectorDevices)
    .values({
      tenantId: config.tenantId,
      deviceCode,
      deviceName: values.deviceName || "设备-" + suffix,
      deviceToken: values.deviceToken,
      platform: values.platform,
      appVersion: values.appVersion,
      lastIp: values.lastIp,
      accountProfile: defaultAccountProfile(deviceCode),
      status: "offline",
      remark: "registered: " + new Date().toISOString()
    })
    .returning();
  return created;
}

export async function listDevices() {
  return db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), isNull(collectorDevices.deletedAt)))
    .orderBy(asc(collectorDevices.deviceName), asc(collectorDevices.deviceCode), asc(collectorDevices.createdAt));
}

export async function updateDeviceByCode(deviceCode: string, values: Partial<typeof collectorDevices.$inferInsert>) {
  const [device] = await db
    .update(collectorDevices)
    .set({
      ...values,
      updatedAt: new Date(),
      updatedBy: "admin"
    })
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .returning();
  return device ?? null;
}

export async function markDeviceCommandIssued(deviceId: string) {
  await db
    .update(collectorDevices)
    .set({ lastCommandAt: new Date(), updatedAt: new Date() })
    .where(eq(collectorDevices.id, deviceId));
}

export async function countDevices() {
  const devices = await listDevices();
  return devices.length;
}
