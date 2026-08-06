# 接口定时凭据持久化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“视频发布 > 接口定时”内完成接口配置的新建、编辑、测试和持久化，使每个配置独立保存 AES-256-GCM 加密 Token，并让测试连接、任务领取和状态回写统一使用数据库优先、环境变量兜底的凭据解析链路。

**Architecture:** 保留 `remote_script_configs` 作为非敏感接口配置和成熟执行参数的载体，新增一对一的 `publish_interface_credentials` 表保存密文。新增接口发布专用配置 API，把普通配置写入与凭据写入封装在同一事务中；运行时只通过统一解析器取得短生命周期明文，再传给现有外部接口客户端。前端用专用轻量面板替换“接口定时”页中的通用远程脚本编辑器，不修改外部协议和手机发布动作。

**Tech Stack:** Bun、TypeScript、Hono、Zod、Drizzle ORM、PostgreSQL、React 19、TanStack Query、Ant Design、AES-256-GCM（Node `crypto`）

**Authoritative design:** `docs/superpowers/specs/2026-08-06-interface-publish-credentials-design.md`

**Protected boundary:** 不修改父文档 `通过接口发布视频架构设计.md`，不修改 `mobile-agent/autojs/features/publish-video/**` 中的成熟发布动作。

---

## 文件结构

- Create: `account-data-platform/packages/types/src/domain/publish-interface-config.ts` - 专用配置 API 的请求、响应契约。
- Modify: `account-data-platform/packages/types/src/index.ts` - 导出专用配置契约。
- Modify: `account-data-platform/packages/db/src/schema-remote-script.ts` - 声明接口凭据表。
- Create: `account-data-platform/packages/db/src/migrations/0031_publish_interface_credentials.sql` - 创建凭据表和唯一索引。
- Modify: `account-data-platform/packages/db/src/migrations/meta/_journal.json` - 登记 0031 迁移。
- Create: `account-data-platform/packages/db/src/publish-interface-credential-schema.test.ts` - 数据库结构测试。
- Create: `account-data-platform/apps/api/src/services/publish-interface-credential.service.ts` - AES-256-GCM 加解密和密钥校验。
- Create: `account-data-platform/apps/api/src/services/publish-interface-credential.service.test.ts` - 密码学单元测试。
- Create: `account-data-platform/apps/api/src/repositories/remote-script-config-hash.ts` - 共享配置哈希算法。
- Modify: `account-data-platform/apps/api/src/repositories/remote-script.repository.ts` - 复用共享哈希算法。
- Create: `account-data-platform/apps/api/src/repositories/publish-interface-config.repository.ts` - 配置与凭据的原子 CRUD。
- Create: `account-data-platform/apps/api/src/repositories/publish-interface-config.repository.test.ts` - 事务与清理集成测试。
- Create: `account-data-platform/apps/api/src/services/publish-interface-config.service.ts` - 默认值、校验、脱敏映射和错误语义。
- Create: `account-data-platform/apps/api/src/services/publish-interface-config.service.test.ts` - 配置业务测试。
- Create: `account-data-platform/apps/api/src/routes/publish-interface-configs.ts` - 专用管理 API。
- Create: `account-data-platform/apps/api/src/routes/publish-interface-configs.test.ts` - API 状态码与泄漏测试。
- Modify: `account-data-platform/apps/api/src/routes/admin.ts` - 挂载专用管理 API。
- Create: `account-data-platform/apps/api/src/services/publish-interface-credential-resolver.ts` - 数据库优先、环境变量兜底解析器。
- Create: `account-data-platform/apps/api/src/services/publish-interface-credential-resolver.test.ts` - 优先级和错误测试。
- Modify: `account-data-platform/apps/api/src/services/wecom-publish-client.ts` - 接收已解析 Token，保留旧环境变量兼容输入。
- Modify: `account-data-platform/apps/api/src/services/wecom-publish-client.test.ts` - 显式 Token、日志脱敏和兼容测试。
- Modify: `account-data-platform/apps/api/src/routes/publish-schedules.ts` - 测试连接使用统一解析器。
- Modify: `account-data-platform/apps/api/src/services/publish-interface-worker.ts` - 领取任务使用统一解析器。
- Modify: `account-data-platform/apps/api/src/services/publish-status-outbox.service.ts` - 状态回写使用统一解析器。
- Modify: `account-data-platform/apps/api/src/services/publish-interface-run.service.ts` - 启动前阻止无凭据配置。
- Modify: `account-data-platform/apps/api/src/services/publish-match.service.ts` - 兼容领取链路使用统一解析器。
- Modify: `account-data-platform/apps/api/src/services/publish-device-scheduler.service.ts` - 兼容调度链路使用统一解析器。
- Modify: `account-data-platform/apps/api/src/services/publish-scheduler.service.ts` - 兼容回写链路使用统一解析器。
- Modify: `account-data-platform/apps/api/src/integration/interface-publish-security.test.ts` - 扩展敏感信息泄漏门禁。
- Create: `account-data-platform/apps/web/src/lib/api-client-interface-publish-configs.ts` - 专用前端 API 客户端。
- Create: `account-data-platform/apps/web/src/routes/InterfacePublishConfigModal.tsx` - 三字段新建和显式换 Token 编辑框。
- Create: `account-data-platform/apps/web/src/routes/InterfacePublishConfigPanel.tsx` - 配置列表和操作入口。
- Modify: `account-data-platform/apps/web/src/routes/PublishSchedulesPage.tsx` - 改用专用面板并保持单页工作流。
- Modify: `account-data-platform/apps/web/tests/interface-publish-end-to-end.test.js` - 单页与前端凭据边界测试。
- Modify: `account-data-platform/apps/web/tests/publish-video-module.test.js` - 防止通用高级配置重新进入接口定时页。
- Modify: `account-data-platform/.env.example` - 记录加密主密钥格式。
- Modify: `account-data-platform/.env.development.example` - 记录本地开发密钥格式。
- Modify: `account-data-platform/.env.production.example` - 记录生产环境必填密钥。

### Task 1: 锁定专用 API 契约和无环境变量的新配置格式

**Files:**
- Create: `account-data-platform/packages/types/src/domain/publish-interface-config.ts`
- Create: `account-data-platform/packages/types/src/domain/publish-interface-config.test.ts`
- Modify: `account-data-platform/packages/types/src/index.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-config.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-config.test.ts`
- Modify: `account-data-platform/apps/api/src/services/remote-script-registry.ts`
- Modify: `account-data-platform/apps/api/src/services/remote-script-registry.test.ts`
- Modify: `account-data-platform/apps/api/src/services/remote-script.service.ts`
- Modify: `account-data-platform/apps/api/src/services/remote-script.service.test.ts`

- [ ] **Step 1: 写专用请求和响应契约的失败测试**

```ts
import { describe, expect, test } from "bun:test";
import {
  createPublishInterfaceConfigSchema,
  publishInterfaceConfigViewSchema,
  updatePublishInterfaceConfigSchema
} from "./publish-interface-config";

describe("publish interface config contracts", () => {
  test("create accepts only name, URL and a non-empty Token", () => {
    expect(createPublishInterfaceConfigSchema.parse({
      configName: "默认发布接口",
      externalBaseUrl: "https://publish.example.test",
      token: "test-token"
    })).toEqual({
      configName: "默认发布接口",
      externalBaseUrl: "https://publish.example.test",
      token: "test-token"
    });
    expect(createPublishInterfaceConfigSchema.safeParse({
      configName: "默认发布接口",
      externalBaseUrl: "https://publish.example.test",
      token: " "
    }).success).toBeFalse();
  });

  test("update may omit Token but may not be empty", () => {
    expect(updatePublishInterfaceConfigSchema.parse({ configName: "新名称" }))
      .toEqual({ configName: "新名称" });
    expect(updatePublishInterfaceConfigSchema.safeParse({ token: "" }).success).toBeFalse();
    expect(updatePublishInterfaceConfigSchema.safeParse({}).success).toBeFalse();
  });

  test("view exposes only tokenConfigured", () => {
    const value = publishInterfaceConfigViewSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      configName: "默认发布接口",
      externalBaseUrl: "https://publish.example.test",
      status: "ENABLED",
      tokenConfigured: true,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z"
    });
    expect(Object.keys(value).sort()).toEqual([
      "configName", "createdAt", "externalBaseUrl", "id",
      "status", "tokenConfigured", "updatedAt"
    ]);
  });
});
```

- [ ] **Step 2: 运行契约测试并确认失败**

Run: `cd account-data-platform; bun test packages/types/src/domain/publish-interface-config.test.ts`

Expected: FAIL，提示找不到 `./publish-interface-config`。

- [ ] **Step 3: 实现并导出专用契约**

```ts
import { z } from "zod";

const configName = z.string().trim().min(1).max(100);
const externalBaseUrl = z.string().trim().url().max(2048);
const token = z.string().trim().min(1).max(4096);

export const createPublishInterfaceConfigSchema = z.object({
  configName,
  externalBaseUrl,
  token
}).strict();

export const updatePublishInterfaceConfigSchema = z.object({
  configName: configName.optional(),
  externalBaseUrl: externalBaseUrl.optional(),
  token: token.optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "至少提供一个需要更新的字段"
});

export const publishInterfaceConfigViewSchema = z.object({
  id: z.string().uuid(),
  configName,
  externalBaseUrl,
  status: z.enum(["ENABLED", "DISABLED"]),
  tokenConfigured: z.boolean(),
  createdAt: z.union([z.string().datetime(), z.date().transform((value) => value.toISOString())]),
  updatedAt: z.union([z.string().datetime(), z.date().transform((value) => value.toISOString())])
}).strict();

export type CreatePublishInterfaceConfigPayload = z.infer<typeof createPublishInterfaceConfigSchema>;
export type UpdatePublishInterfaceConfigPayload = z.infer<typeof updatePublishInterfaceConfigSchema>;
export type PublishInterfaceConfigView = z.infer<typeof publishInterfaceConfigViewSchema>;
```

Add to `packages/types/src/index.ts`:

```ts
export * from "./domain/publish-interface-config";
```

- [ ] **Step 4: 允许新配置省略 `externalTokenEnv`，同时保留旧值校验**

Change the external-pull schemas to:

```ts
const externalPullPublishConfigSchema = publishExecutionConfigSchema.extend({
  sourceMode: z.literal("external_pull").default("external_pull"),
  externalBaseUrl: z.string().url(),
  externalTokenEnv: z.string().min(1).optional(),
  publishTimeSlots: timeSlotSchema,
  platforms: z.array(z.enum(["抖音", "视频号"])).min(1).max(2).default(["抖音"])
}).strip();

export const publishClientOnlyConfigSchema = z.object({
  externalBaseUrl: z.string().url(),
  externalTokenEnv: z.string().min(1).optional()
}).passthrough();
```

In `remote-script-registry.ts`, require only `externalBaseUrl` for `external_pull`. In `remote-script.service.ts`, keep the environment-name regex check only when `externalTokenEnv !== undefined`. Update the three existing tests so they assert: URL remains required, environment variable name is optional, and an environment variable name that is present must still be valid.

- [ ] **Step 5: 运行契约与配置回归测试**

Run: `cd account-data-platform; bun test packages/types/src/domain/publish-interface-config.test.ts apps/api/src/services/publish-config.test.ts apps/api/src/services/remote-script-registry.test.ts apps/api/src/services/remote-script.service.test.ts`

Expected: PASS，且旧 `direct_material` 测试保持通过。

- [ ] **Step 6: 提交契约节点**

```bash
git add account-data-platform/packages/types/src/domain/publish-interface-config.ts account-data-platform/packages/types/src/domain/publish-interface-config.test.ts account-data-platform/packages/types/src/index.ts account-data-platform/apps/api/src/services/publish-config.ts account-data-platform/apps/api/src/services/publish-config.test.ts account-data-platform/apps/api/src/services/remote-script-registry.ts account-data-platform/apps/api/src/services/remote-script-registry.test.ts account-data-platform/apps/api/src/services/remote-script.service.ts account-data-platform/apps/api/src/services/remote-script.service.test.ts
git commit -m "feat: define interface publish credential contracts"
```

### Task 2: 增加一对一凭据表和 0031 迁移

**Files:**
- Modify: `account-data-platform/packages/db/src/schema-remote-script.ts`
- Create: `account-data-platform/packages/db/src/publish-interface-credential-schema.test.ts`
- Create: `account-data-platform/packages/db/src/migrations/0031_publish_interface_credentials.sql`
- Modify: `account-data-platform/packages/db/src/migrations/meta/_journal.json`

- [ ] **Step 1: 写表名、字段和唯一约束失败测试**

```ts
import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { publishInterfaceCredentials } from "./schema";

describe("publish interface credential schema", () => {
  test("stores encrypted material outside config payload", () => {
    expect(getTableName(publishInterfaceCredentials)).toBe("publish_interface_credentials");
    expect(publishInterfaceCredentials.configId.name).toBe("config_id");
    expect(publishInterfaceCredentials.tokenCiphertext.name).toBe("token_ciphertext");
    expect(publishInterfaceCredentials.tokenIv.name).toBe("token_iv");
    expect(publishInterfaceCredentials.tokenAuthTag.name).toBe("token_auth_tag");
    expect(publishInterfaceCredentials.keyVersion.name).toBe("key_version");
  });

  test("allows one credential per tenant and config", () => {
    const index = getTableConfig(publishInterfaceCredentials).indexes.find(
      (candidate) => candidate.config.name === "uniq_publish_interface_credentials_tenant_config"
    );
    expect(index?.config.unique).toBeTrue();
    expect(index?.config.columns.map((column) => "name" in column ? column.name : "expression"))
      .toEqual(["tenant_id", "config_id"]);
  });
});
```

- [ ] **Step 2: 运行结构测试并确认失败**

Run: `cd account-data-platform; bun test packages/db/src/publish-interface-credential-schema.test.ts`

Expected: FAIL，提示 `publishInterfaceCredentials` 未导出。

- [ ] **Step 3: 在 `schema-remote-script.ts` 声明凭据表**

Add `text` to the Drizzle imports and add:

```ts
export const publishInterfaceCredentials = pgTable(
  "publish_interface_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull().default("default"),
    configId: uuid("config_id").notNull().references(() => remoteScriptConfigs.id),
    tokenCiphertext: text("token_ciphertext").notNull(),
    tokenIv: varchar("token_iv", { length: 64 }).notNull(),
    tokenAuthTag: varchar("token_auth_tag", { length: 64 }).notNull(),
    keyVersion: varchar("key_version", { length: 16 }).notNull().default("v1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar("created_by", { length: 64 }).notNull().default("system"),
    updatedBy: varchar("updated_by", { length: 64 }).notNull().default("system")
  },
  (table) => [
    uniqueIndex("uniq_publish_interface_credentials_tenant_config")
      .on(table.tenantId, table.configId)
  ]
);
```

- [ ] **Step 4: 编写 0031 SQL 并登记 journal**

```sql
CREATE TABLE IF NOT EXISTS "publish_interface_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
  "config_id" uuid NOT NULL REFERENCES "remote_script_configs"("id"),
  "token_ciphertext" text NOT NULL,
  "token_iv" varchar(64) NOT NULL,
  "token_auth_tag" varchar(64) NOT NULL,
  "key_version" varchar(16) DEFAULT 'v1' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" varchar(64) DEFAULT 'system' NOT NULL,
  "updated_by" varchar(64) DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_publish_interface_credentials_tenant_config"
  ON "publish_interface_credentials" ("tenant_id", "config_id");
```

Append journal entry `idx: 31`, `tag: "0031_publish_interface_credentials"`, `version: "7"`, `breakpoints: true`.

- [ ] **Step 5: 运行结构测试和类型检查**

Run: `cd account-data-platform; bun test packages/db/src/publish-interface-credential-schema.test.ts && bun --filter @pkg/db typecheck`

Expected: PASS。

- [ ] **Step 6: 提交数据库节点**

```bash
git add account-data-platform/packages/db/src/schema-remote-script.ts account-data-platform/packages/db/src/publish-interface-credential-schema.test.ts account-data-platform/packages/db/src/migrations/0031_publish_interface_credentials.sql account-data-platform/packages/db/src/migrations/meta/_journal.json
git commit -m "feat: add interface publish credential table"
```

### Task 3: 实现 AES-256-GCM 凭据服务

**Files:**
- Create: `account-data-platform/apps/api/src/services/publish-interface-credential.service.ts`
- Create: `account-data-platform/apps/api/src/services/publish-interface-credential.service.test.ts`

- [ ] **Step 1: 写加解密、随机 IV、错误密钥和 AAD 隔离测试**

```ts
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  PublishInterfaceCredentialError,
  decryptPublishInterfaceToken,
  encryptPublishInterfaceToken
} from "./publish-interface-credential.service";

const key = randomBytes(32).toString("base64");
const context = { tenantId: "default", configId: "11111111-1111-4111-8111-111111111111" };

describe("publish interface credential encryption", () => {
  test("round trips without deterministic ciphertext", () => {
    const first = encryptPublishInterfaceToken("token-value", context, key);
    const second = encryptPublishInterfaceToken("token-value", context, key);
    expect(decryptPublishInterfaceToken(first, context, key)).toBe("token-value");
    expect(first.tokenCiphertext).not.toBe(second.tokenCiphertext);
    expect(first.tokenIv).not.toBe(second.tokenIv);
  });

  test("rejects wrong key, tampering and copied AAD", () => {
    const encrypted = encryptPublishInterfaceToken("token-value", context, key);
    const actions = [
      () => decryptPublishInterfaceToken(encrypted, context, randomBytes(32).toString("base64")),
      () => decryptPublishInterfaceToken({ ...encrypted, tokenCiphertext: encrypted.tokenCiphertext.slice(0, -2) + "AA" }, context, key),
      () => decryptPublishInterfaceToken(encrypted, { ...context, configId: "22222222-2222-4222-8222-222222222222" }, key)
    ];
    for (const action of actions) expect(action).toThrow(PublishInterfaceCredentialError);
  });

  test("requires a 32-byte Base64 master key", () => {
    expect(() => encryptPublishInterfaceToken("token", context, "bad-key"))
      .toThrowError("PUBLISH_CREDENTIAL_KEY_INVALID");
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-interface-credential.service.test.ts`

Expected: FAIL，提示凭据服务不存在。

- [ ] **Step 3: 实现懒加载密钥和 AES-256-GCM**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type PublishInterfaceCredentialContext = { tenantId: string; configId: string };
export type EncryptedPublishInterfaceToken = {
  tokenCiphertext: string;
  tokenIv: string;
  tokenAuthTag: string;
  keyVersion: "v1";
};

export class PublishInterfaceCredentialError extends Error {
  constructor(
    readonly code: "PUBLISH_CREDENTIAL_KEY_MISSING" | "PUBLISH_CREDENTIAL_KEY_INVALID" | "PUBLISH_CREDENTIAL_DECRYPT_FAILED",
    readonly userMessage: string
  ) { super(code); }
}

function masterKey(value = process.env.PUBLISH_CREDENTIAL_ENCRYPTION_KEY) {
  if (!value) throw new PublishInterfaceCredentialError("PUBLISH_CREDENTIAL_KEY_MISSING", "服务端加密密钥未配置");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new PublishInterfaceCredentialError("PUBLISH_CREDENTIAL_KEY_INVALID", "服务端加密密钥格式错误");
  }
  return decoded;
}

function aad(context: PublishInterfaceCredentialContext) {
  return Buffer.from(JSON.stringify([context.tenantId, context.configId]), "utf8");
}

export function encryptPublishInterfaceToken(
  token: string,
  context: PublishInterfaceCredentialContext,
  keyValue?: string
): EncryptedPublishInterfaceToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(keyValue), iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    tokenCiphertext: ciphertext.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenAuthTag: cipher.getAuthTag().toString("base64"),
    keyVersion: "v1"
  };
}

export function decryptPublishInterfaceToken(
  encrypted: EncryptedPublishInterfaceToken,
  context: PublishInterfaceCredentialContext,
  keyValue?: string
) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(keyValue), Buffer.from(encrypted.tokenIv, "base64"));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(Buffer.from(encrypted.tokenAuthTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.tokenCiphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof PublishInterfaceCredentialError) throw error;
    throw new PublishInterfaceCredentialError("PUBLISH_CREDENTIAL_DECRYPT_FAILED", "接口凭据无法解密");
  }
}
```

- [ ] **Step 4: 运行密码学测试**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-interface-credential.service.test.ts`

Expected: PASS；测试输出和错误消息均不包含 `token-value`。

- [ ] **Step 5: 提交密码学节点**

```bash
git add account-data-platform/apps/api/src/services/publish-interface-credential.service.ts account-data-platform/apps/api/src/services/publish-interface-credential.service.test.ts
git commit -m "feat: encrypt interface publish tokens"
```

### Task 4: 实现配置与凭据的事务仓储

**Files:**
- Create: `account-data-platform/apps/api/src/repositories/remote-script-config-hash.ts`
- Modify: `account-data-platform/apps/api/src/repositories/remote-script.repository.ts`
- Create: `account-data-platform/apps/api/src/repositories/publish-interface-config.repository.ts`
- Create: `account-data-platform/apps/api/src/repositories/publish-interface-config.repository.test.ts`

- [ ] **Step 1: 写数据库事务失败测试**

The integration test must create unique UUID/name values, then assert these cases:

```ts
test("creates config and credential atomically", async () => {
  const configId = crypto.randomUUID();
  createdIds.push(configId);
  const created = await createPublishInterfaceConfigAtomic({
    id: configId,
    configName: `credential-${configId}`,
    configPayload: externalPayload("https://publish.example.test"),
    status: "ENABLED",
    credential: encrypted("cipher-a"),
    actor: "repository-test"
  });
  const saved = await findPublishInterfaceConfigRaw(created.id);
  expect(saved?.credential?.tokenCiphertext).toBe("cipher-a");
  expect(saved?.config.configPayload).not.toHaveProperty("token");
});

test("rolls back config when credential insert fails", async () => {
  const configId = crypto.randomUUID();
  await expect(createPublishInterfaceConfigAtomic({
    id: configId,
    configName: `rollback-${configId}`,
    configPayload: externalPayload("https://publish.example.test"),
    status: "ENABLED",
    credential: { ...encrypted("cipher-b"), keyVersion: "x".repeat(32) },
    actor: "repository-test"
  })).rejects.toBeDefined();
  expect(await findPublishInterfaceConfigRaw(configId)).toBeNull();
});

test("deletes credential and soft deletes config in one transaction", async () => {
  const saved = await createFixture();
  await deletePublishInterfaceConfigAtomic(saved.id, "repository-test");
  expect(await findPublishInterfaceConfigRaw(saved.id)).toBeNull();
  const [credential] = await db.select().from(publishInterfaceCredentials)
    .where(eq(publishInterfaceCredentials.configId, saved.id));
  expect(credential).toBeUndefined();
});
```

- [ ] **Step 2: 运行仓储测试并确认失败**

Run: `cd account-data-platform; bun test apps/api/src/repositories/publish-interface-config.repository.test.ts`

Expected: FAIL，提示专用仓储导出不存在。

- [ ] **Step 3: 提取并复用配置哈希函数**

Move the existing canonical JSON/hash logic from `remote-script.repository.ts` into:

```ts
import { createHash } from "node:crypto";

function normalizeHashValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeHashValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeHashValue(item)]));
  }
  return value;
}

export function buildRemoteScriptConfigHash(
  scriptKey: string,
  payload: Record<string, unknown>,
  revision: number
) {
  return createHash("sha256")
    .update(JSON.stringify([scriptKey, normalizeHashValue(payload), revision]))
    .digest("hex");
}
```

Update the existing repository to import this function without changing existing hash semantics.

- [ ] **Step 4: 实现专用仓储的明确边界**

Export exactly these operations:

```ts
export type PublishInterfaceCredentialWrite = {
  tokenCiphertext: string;
  tokenIv: string;
  tokenAuthTag: string;
  keyVersion: string;
};

export function listPublishInterfaceConfigsRaw(): Promise<PublishInterfaceConfigRaw[]>;
export function findPublishInterfaceConfigRaw(configId: string): Promise<PublishInterfaceConfigRaw | null>;
export function createPublishInterfaceConfigAtomic(input: {
  id: string;
  configName: string;
  configPayload: Record<string, unknown>;
  status: "ENABLED";
  credential: PublishInterfaceCredentialWrite;
  actor: string;
}): Promise<PublishInterfaceConfigRaw>;
export function updatePublishInterfaceConfigAtomic(input: {
  configId: string;
  configName?: string;
  configPayload?: Record<string, unknown>;
  credential?: PublishInterfaceCredentialWrite;
  actor: string;
}): Promise<PublishInterfaceConfigRaw | null>;
export function deletePublishInterfaceConfigAtomic(configId: string, actor: string): Promise<boolean>;
```

`createPublishInterfaceConfigAtomic` must use `db.transaction`, insert `remote_script_configs` with `scriptKey: "publish_video"`, revision 1 and `buildRemoteScriptConfigHash(...)`, then insert the credential. `updatePublishInterfaceConfigAtomic` must increment revision/hash only when ordinary config fields change and must upsert the credential only when `input.credential` is present. `deletePublishInterfaceConfigAtomic` must delete the credential before soft deleting the config in the same transaction. All reads must constrain `tenantId`, `scriptKey`, `sourceMode = external_pull`, and `deletedAt IS NULL`.

- [ ] **Step 5: 运行仓储、旧哈希和数据库结构测试**

Run: `cd account-data-platform; bun test apps/api/src/repositories/publish-interface-config.repository.test.ts apps/api/src/repositories/remote-script.repository.test.ts packages/db/src/publish-interface-credential-schema.test.ts`

Expected: PASS，事务回滚测试不留下 `remote_script_configs` 记录。

- [ ] **Step 6: 提交仓储节点**

```bash
git add account-data-platform/apps/api/src/repositories/remote-script-config-hash.ts account-data-platform/apps/api/src/repositories/remote-script.repository.ts account-data-platform/apps/api/src/repositories/publish-interface-config.repository.ts account-data-platform/apps/api/src/repositories/publish-interface-config.repository.test.ts
git commit -m "feat: persist interface configs and credentials atomically"
```

### Task 5: 实现默认参数、脱敏视图和配置业务规则

**Files:**
- Create: `account-data-platform/apps/api/src/services/publish-interface-config.service.ts`
- Create: `account-data-platform/apps/api/src/services/publish-interface-config.service.test.ts`

- [ ] **Step 1: 写业务服务失败测试**

Use an injected fake repository and crypto function. Cover these exact assertions:

```ts
test("create stores defaults and never puts Token in configPayload", async () => {
  await service.create({
    configName: "默认接口",
    externalBaseUrl: "https://publish.example.test",
    token: "secret-token"
  }, "tester");
  expect(writes[0]?.configPayload).toEqual({
    sourceMode: "external_pull",
    responseDelayMsMin: 700,
    responseDelayMsMax: 1200,
    actionWaitMsMin: 900,
    actionWaitMsMax: 1500,
    expectedTopicCount: 5,
    requireCover: true,
    topicResolveTimeoutMinutes: 30,
    downloadDir: "/sdcard/",
    publishTimeSlots: [],
    platforms: ["抖音"]
  });
  expect(JSON.stringify(writes[0]?.configPayload)).not.toContain("secret-token");
});

test("update without Token leaves credential untouched", async () => {
  await service.update(configId, { configName: "改名" }, "tester");
  expect(updates[0]?.credential).toBeUndefined();
});

test("update with Token supplies a replacement credential", async () => {
  await service.update(configId, { token: "replacement" }, "tester");
  expect(updates[0]?.credential).toMatchObject({ keyVersion: "v1" });
});

test("view never exposes payload, env name or encrypted fields", async () => {
  const result = await service.list();
  const serialized = JSON.stringify(result);
  for (const forbidden of ["configPayload", "externalTokenEnv", "tokenCiphertext", "tokenIv", "tokenAuthTag"])
    expect(serialized).not.toContain(forbidden);
});
```

Also test that a legacy row with no database credential reports `tokenConfigured: true` only when its `externalTokenEnv` resolves to a non-empty environment value.

- [ ] **Step 2: 运行服务测试并确认失败**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-interface-config.service.test.ts`

Expected: FAIL，提示配置服务不存在。

- [ ] **Step 3: 实现默认值和脱敏映射**

Use this exact default object and keep it backend-only:

```ts
export const DEFAULT_INTERFACE_PUBLISH_CONFIG = {
  sourceMode: "external_pull",
  responseDelayMsMin: 700,
  responseDelayMsMax: 1200,
  actionWaitMsMin: 900,
  actionWaitMsMax: 1500,
  expectedTopicCount: 5,
  requireCover: true,
  topicResolveTimeoutMinutes: 30,
  downloadDir: "/sdcard/",
  publishTimeSlots: [],
  platforms: ["抖音"]
} as const;
```

The service must generate the config UUID before encryption so AAD can include it:

```ts
const configId = crypto.randomUUID();
const credential = encryptPublishInterfaceToken(payload.token, {
  tenantId: config.tenantId,
  configId
});
return view(await repository.create({
  id: configId,
  configName: payload.configName,
  configPayload: { ...DEFAULT_INTERFACE_PUBLISH_CONFIG, externalBaseUrl: payload.externalBaseUrl },
  status: "ENABLED",
  credential,
  actor
}));
```

`view(...)` must return only the seven fields defined by `PublishInterfaceConfigView`. Map database credential presence first; for a legacy row only, evaluate `process.env[externalTokenEnv]` to produce `tokenConfigured` without returning either name or value. Convert unique violations to `PUBLISH_INTERFACE_CONFIG_NAME_CONFLICT`, missing rows to `PUBLISH_INTERFACE_CONFIG_NOT_FOUND`, and pass credential key/decryption codes through without embedding secrets.

- [ ] **Step 4: 运行服务测试**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-interface-config.service.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交业务节点**

```bash
git add account-data-platform/apps/api/src/services/publish-interface-config.service.ts account-data-platform/apps/api/src/services/publish-interface-config.service.test.ts
git commit -m "feat: add interface publish config service"
```

### Task 6: 暴露专用管理 API 并建立泄漏门禁

**Files:**
- Create: `account-data-platform/apps/api/src/routes/publish-interface-configs.ts`
- Create: `account-data-platform/apps/api/src/routes/publish-interface-configs.test.ts`
- Modify: `account-data-platform/apps/api/src/routes/admin.ts`
- Modify: `account-data-platform/apps/api/src/integration/interface-publish-security.test.ts`

- [ ] **Step 1: 写 CRUD、错误状态和响应脱敏失败测试**

Mount the route with an injected admin context and mocked service. Assert:

```ts
expect((await app.request("/configs")).status).toBe(200);
expect((await app.request("/configs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    configName: "默认接口",
    externalBaseUrl: "https://publish.example.test",
    token: "route-secret"
  })
})).status).toBe(201);
expect((await app.request(`/configs/${configId}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ configName: "仅改名" })
})).status).toBe(200);
expect((await app.request(`/configs/${configId}`, { method: "DELETE" })).status).toBe(200);
```

Serialize every success and error response and assert it excludes the submitted Token, `Authorization`, `tokenCiphertext`, `tokenIv`, `tokenAuthTag`, `externalTokenEnv`, and `configPayload`. Add `/admin/interface-publish/configs` to the unauthenticated route list in `interface-publish-security.test.ts`.

- [ ] **Step 2: 运行路由测试并确认失败**

Run: `cd account-data-platform; bun test apps/api/src/routes/publish-interface-configs.test.ts apps/api/src/integration/interface-publish-security.test.ts`

Expected: FAIL，提示路由不存在或未挂载。

- [ ] **Step 3: 实现并挂载路由**

```ts
export const publishInterfaceConfigRoutes = new Hono<{ Variables: AdminVariables }>();

publishInterfaceConfigRoutes.get("/", async (c) =>
  c.json({ data: await publishInterfaceConfigService.list() }));

publishInterfaceConfigRoutes.post("/", async (c) => {
  const parsed = createPublishInterfaceConfigSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    return c.json(await publishInterfaceConfigService.create(parsed.data, c.get("admin").username), 201);
  } catch (error) {
    return publishInterfaceConfigErrorResponse(c, error);
  }
});

publishInterfaceConfigRoutes.patch("/:configId", async (c) => {
  const parsed = updatePublishInterfaceConfigSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return validationError(c, parsed.error);
  try {
    return c.json(await publishInterfaceConfigService.update(
      c.req.param("configId"), parsed.data, c.get("admin").username
    ));
  } catch (error) {
    return publishInterfaceConfigErrorResponse(c, error);
  }
});

publishInterfaceConfigRoutes.delete("/:configId", async (c) => {
  try {
    await publishInterfaceConfigService.delete(c.req.param("configId"), c.get("admin").username);
    return c.json({ success: true });
  } catch (error) {
    return publishInterfaceConfigErrorResponse(c, error);
  }
});
```

Mount after `adminRoutes.use("*", adminAuth)`:

```ts
adminRoutes.route("/interface-publish/configs", publishInterfaceConfigRoutes);
```

Map validation to 400, not found to 404, name conflict to 409, and missing/invalid encryption key to 503. Error details may contain `configId` but must not contain payload or credential material.

- [ ] **Step 4: 运行路由与安全测试**

Run: `cd account-data-platform; bun test apps/api/src/routes/publish-interface-configs.test.ts apps/api/src/integration/interface-publish-security.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交 API 节点**

```bash
git add account-data-platform/apps/api/src/routes/publish-interface-configs.ts account-data-platform/apps/api/src/routes/publish-interface-configs.test.ts account-data-platform/apps/api/src/routes/admin.ts account-data-platform/apps/api/src/integration/interface-publish-security.test.ts
git commit -m "feat: expose interface publish config API"
```

### Task 7: 建立数据库优先、环境变量兜底的唯一解析器

**Files:**
- Create: `account-data-platform/apps/api/src/services/publish-interface-credential-resolver.ts`
- Create: `account-data-platform/apps/api/src/services/publish-interface-credential-resolver.test.ts`
- Modify: `account-data-platform/apps/api/src/services/wecom-publish-client.ts`
- Modify: `account-data-platform/apps/api/src/services/wecom-publish-client.test.ts`

- [ ] **Step 1: 写解析优先级和错误测试**

```ts
test("database credential wins over legacy environment value", async () => {
  const resolver = createPublishInterfaceCredentialResolver({
    load: async () => rawConfig({ credential: encryptedDbToken, externalTokenEnv: "LEGACY_TOKEN" }),
    decrypt: () => "database-token",
    env: { LEGACY_TOKEN: "legacy-token" }
  });
  expect(await resolver.resolve(configId)).toEqual({
    externalBaseUrl: "https://publish.example.test",
    token: "database-token"
  });
});

test("falls back to legacy environment value", async () => {
  const resolver = createPublishInterfaceCredentialResolver({
    load: async () => rawConfig({ credential: null, externalTokenEnv: "LEGACY_TOKEN" }),
    env: { LEGACY_TOKEN: "legacy-token" }
  });
  expect((await resolver.resolve(configId)).token).toBe("legacy-token");
});

test("rejects missing and undecryptable credentials without leaking values", async () => {
  await expect(missingResolver.resolve(configId)).rejects.toMatchObject({
    code: "PUBLISH_INTERFACE_TOKEN_NOT_CONFIGURED"
  });
  await expect(brokenResolver.resolve(configId)).rejects.toMatchObject({
    code: "PUBLISH_CREDENTIAL_DECRYPT_FAILED"
  });
});
```

- [ ] **Step 2: 运行解析器测试并确认失败**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-interface-credential-resolver.test.ts`

Expected: FAIL，提示解析器不存在。

- [ ] **Step 3: 实现唯一解析器**

```ts
export type ResolvedWecomPublishClientConfig = {
  externalBaseUrl: string;
  token: string;
};

export function createPublishInterfaceCredentialResolver(dependencies: ResolverDependencies = {}) {
  const load = dependencies.load ?? findPublishInterfaceConfigRaw;
  const decrypt = dependencies.decrypt ?? decryptPublishInterfaceToken;
  const env = dependencies.env ?? process.env;
  return {
    async resolve(configId: string): Promise<ResolvedWecomPublishClientConfig> {
      const row = await load(configId);
      if (!row) throw new PublishInterfaceCredentialResolverError(
        "PUBLISH_INTERFACE_CONFIG_NOT_FOUND", "接口定时配置不存在"
      );
      const base = publishClientOnlyConfigSchema.parse(row.config.configPayload);
      if (row.credential) {
        return {
          externalBaseUrl: base.externalBaseUrl,
          token: decrypt(row.credential, { tenantId: row.config.tenantId, configId })
        };
      }
      const token = base.externalTokenEnv ? env[base.externalTokenEnv] : undefined;
      if (!token) throw new PublishInterfaceCredentialResolverError(
        "PUBLISH_INTERFACE_TOKEN_NOT_CONFIGURED", "Token 未配置"
      );
      return { externalBaseUrl: base.externalBaseUrl, token };
    }
  };
}

export const publishInterfaceCredentialResolver = createPublishInterfaceCredentialResolver();
```

- [ ] **Step 4: 让外部客户端优先接受显式 Token，同时保留兼容输入**

Use a discriminated union:

```ts
export type WecomPublishClientConfig = { externalBaseUrl: string } & (
  | { token: string; externalTokenEnv?: never }
  | { token?: never; externalTokenEnv: string }
);

function tokenFor(clientConfig: WecomPublishClientConfig) {
  if (clientConfig.token) return clientConfig.token;
  const token = process.env[clientConfig.externalTokenEnv];
  if (!token) throw new WecomPublishClientError(0, "EXTERNAL_TOKEN_ENV_MISSING", "外部接口 Token 未配置");
  return token;
}
```

Add a client test proving an explicit Token wins and never appears in logs. Keep one existing environment-variable client test to protect backward compatibility. Change the 401/403 user message to `外部接口认证失败，请检查或更换 Token`.

- [ ] **Step 5: 运行解析器和客户端测试**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-interface-credential-resolver.test.ts apps/api/src/services/wecom-publish-client.test.ts`

Expected: PASS；serialized logs exclude both database and environment Token values。

- [ ] **Step 6: 提交解析节点**

```bash
git add account-data-platform/apps/api/src/services/publish-interface-credential-resolver.ts account-data-platform/apps/api/src/services/publish-interface-credential-resolver.test.ts account-data-platform/apps/api/src/services/wecom-publish-client.ts account-data-platform/apps/api/src/services/wecom-publish-client.test.ts
git commit -m "feat: resolve interface publish credentials"
```

### Task 8: 接通测试连接、无人值守领取、回写和启动门禁

**Files:**
- Modify: `account-data-platform/apps/api/src/routes/publish-schedules.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-interface-worker.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-interface-worker.test.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-status-outbox.service.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-status-outbox.service.test.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-interface-run.service.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-interface-run.service.test.ts`
- Modify: `account-data-platform/apps/api/src/integration/interface-publish-flow.test.ts`

- [ ] **Step 1: 先写三个调用点共用解析器的失败测试**

Add injected spies and assert:

```ts
expect(resolveCalls).toEqual([configId]); // test connection
expect(workerResolveCalls).toEqual([configId]); // claim before scheduler execution
expect(outboxResolveCalls).toEqual([configId]); // PATCH before external status update
```

For run preflight:

```ts
await expect(service.create(validRunConfig, "tester"))
  .rejects.toMatchObject({ code: "PUBLISH_INTERFACE_TOKEN_NOT_CONFIGURED" });
expect(repository.create).not.toHaveBeenCalled();
```

- [ ] **Step 2: 运行相关测试并确认失败**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-interface-worker.test.ts apps/api/src/services/publish-status-outbox.service.test.ts apps/api/src/services/publish-interface-run.service.test.ts apps/api/src/integration/interface-publish-flow.test.ts`

Expected: FAIL，解析 spy 未被调用或启动未被阻止。

- [ ] **Step 3: 修改测试连接路由**

Replace the direct `publishVideoConfigSchema` client object with:

```ts
const saved = await getExternalPublishConfig(c.req.param("configId"));
const clientConfig = await publishInterfaceCredentialResolver.resolve(saved.id);
return c.json(await testConnection(clientConfig));
```

Make `getExternalPublishConfig` return the saved config row, not only its payload. Keep the existing URL/source-mode validation.

- [ ] **Step 4: 修改 worker 和 outbox**

In `publish-interface-worker.ts`:

```ts
const clientConfig = await publishInterfaceCredentialResolver.resolve(run.configId);
```

Use that result for `publishInterfaceClaimService.claimOne`. Continue passing `publishConfig` unchanged as `commandConfig`, so the mobile command and action timings are untouched.

In `publish-status-outbox.service.ts`, stop parsing `context.configPayload` as client credentials. Use the immutable task config ID:

```ts
return {
  clientConfig: await publishInterfaceCredentialResolver.resolve(task.configId),
  externalTaskId: task.taskId,
  payload: entry.payload
};
```

- [ ] **Step 5: 在创建运行记录前检查凭据**

Add `assertCredential` to `RunServiceDependencies`, defaulting to `configId => publishInterfaceCredentialResolver.resolve(configId).then(() => undefined)`. Call it after time validation and before `repository.create`. Convert the resolver's no-token error into a `PublishInterfaceRunServiceError` with code `PUBLISH_INTERFACE_TOKEN_NOT_CONFIGURED` and user message `Token 未配置，请先编辑接口配置`.

- [ ] **Step 6: 运行主动链路测试**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-interface-worker.test.ts apps/api/src/services/publish-status-outbox.service.test.ts apps/api/src/services/publish-interface-run.service.test.ts apps/api/src/integration/interface-publish-flow.test.ts`

Expected: PASS；领取和回写断言仍与原外部接口请求体完全一致。

- [ ] **Step 7: 提交主动链路节点**

```bash
git add account-data-platform/apps/api/src/routes/publish-schedules.ts account-data-platform/apps/api/src/services/publish-interface-worker.ts account-data-platform/apps/api/src/services/publish-interface-worker.test.ts account-data-platform/apps/api/src/services/publish-status-outbox.service.ts account-data-platform/apps/api/src/services/publish-status-outbox.service.test.ts account-data-platform/apps/api/src/services/publish-interface-run.service.ts account-data-platform/apps/api/src/services/publish-interface-run.service.test.ts account-data-platform/apps/api/src/integration/interface-publish-flow.test.ts
git commit -m "feat: use persisted credentials in interface publish runtime"
```

### Task 9: 清理兼容链路中的直接 Token 解析

**Files:**
- Modify: `account-data-platform/apps/api/src/services/publish-match.service.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-match.service.test.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-device-scheduler.service.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-device-scheduler.service.test.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-scheduler.service.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-scheduler.service.test.ts`

- [ ] **Step 1: 写兼容调用点的解析器失败测试**

For each service, inject `resolveClientConfig` and assert the external client receives `{ externalBaseUrl, token }`, not the parsed `configPayload`. Preserve all existing claim bodies and PATCH bodies.

```ts
expect(resolveClientConfig).toHaveBeenCalledWith(configId);
expect(claimTask).toHaveBeenCalledWith(
  { externalBaseUrl: "https://publish.example.test", token: "resolved-token" },
  { platform: "抖音", accountName: "测试账号" },
  expect.any(Object)
);
```

- [ ] **Step 2: 运行兼容服务测试并确认失败**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-match.service.test.ts apps/api/src/services/publish-device-scheduler.service.test.ts apps/api/src/services/publish-scheduler.service.test.ts`

Expected: FAIL，外部客户端仍收到含 `externalTokenEnv` 的普通配置。

- [ ] **Step 3: 逐一改用统一解析器**

- `publish-match.service.ts`: 在完成 source-mode 校验后按 `configId` 解析一次，领取和素材无效回写都复用该结果。
- `publish-device-scheduler.service.ts`: 每个 schedule/config 批次只解析一次，claim 和无效素材 PATCH 复用该结果。
- `publish-scheduler.service.ts`: `reportWithoutDispatch` 按 `task.configId` 解析；动作命令仍接收原 `PublishVideoConfig`，不得把 Token 加入手机 payload。

Keep resolver functions injectable in dependency objects so unit tests never need real database credentials.

- [ ] **Step 4: 扫描生产调用点**

Run: `cd account-data-platform; rg -n "claim(Task|RawTask|InterfacePublishTask)\(|patchTaskStatus\(|testConnection\(" apps/api/src --glob "!**/*.test.ts"`

Expected: 每个生产调用点上游都能追溯到 `publishInterfaceCredentialResolver.resolve(configId)`；`wecom-publish-client.ts` 自身函数声明除外。不得再把 `publishVideoConfigSchema.parse(...configPayload)` 的结果直接传入外部客户端。

- [ ] **Step 5: 运行兼容测试**

Run: `cd account-data-platform; bun test apps/api/src/services/publish-match.service.test.ts apps/api/src/services/publish-device-scheduler.service.test.ts apps/api/src/services/publish-scheduler.service.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交兼容节点**

```bash
git add account-data-platform/apps/api/src/services/publish-match.service.ts account-data-platform/apps/api/src/services/publish-match.service.test.ts account-data-platform/apps/api/src/services/publish-device-scheduler.service.ts account-data-platform/apps/api/src/services/publish-device-scheduler.service.test.ts account-data-platform/apps/api/src/services/publish-scheduler.service.ts account-data-platform/apps/api/src/services/publish-scheduler.service.test.ts
git commit -m "refactor: centralize interface publish Token resolution"
```

### Task 10: 实现前端专用 API 和轻量配置弹窗

**Files:**
- Create: `account-data-platform/apps/web/src/lib/api-client-interface-publish-configs.ts`
- Create: `account-data-platform/apps/web/src/routes/InterfacePublishConfigModal.tsx`
- Modify: `account-data-platform/apps/web/tests/interface-publish-end-to-end.test.js`

- [ ] **Step 1: 写前端静态边界失败测试**

Add the client and modal paths to the test file, then assert:

```js
for (const route of [
  "/admin/interface-publish/configs",
  "/admin/publish-schedules/"
]) assert(configSources.includes(route));

for (const forbidden of [
  "localStorage", "sessionStorage", "externalTokenEnv",
  "configPayloadText", "DynamicConfigForm"
]) assert(!configSources.includes(forbidden));

for (const required of [
  "配置名称", "接口地址", "Token", "Token 已配置", "更换 Token", "Input.Password"
]) assert(modalSource.includes(required));
```

- [ ] **Step 2: 运行前端测试并确认失败**

Run: `cd account-data-platform; bun test apps/web/tests/interface-publish-end-to-end.test.js`

Expected: FAIL，专用客户端或弹窗文件不存在。

- [ ] **Step 3: 实现专用 API 客户端**

```ts
import type {
  CreatePublishInterfaceConfigPayload,
  PublishInterfaceConfigView,
  UpdatePublishInterfaceConfigPayload
} from "@pkg/types";
import { mutate, patch, remove, request } from "./api-client";

export const interfacePublishConfigQueryKey = ["interfacePublishConfigs"] as const;

export function getInterfacePublishConfigs() {
  return request<{ data: PublishInterfaceConfigView[] }>("/admin/interface-publish/configs");
}
export function createInterfacePublishConfig(payload: CreatePublishInterfaceConfigPayload) {
  return mutate<PublishInterfaceConfigView>("/admin/interface-publish/configs", payload);
}
export function updateInterfacePublishConfig(configId: string, payload: UpdatePublishInterfaceConfigPayload) {
  return patch<PublishInterfaceConfigView>(`/admin/interface-publish/configs/${encodeURIComponent(configId)}`, payload);
}
export function deleteInterfacePublishConfig(configId: string) {
  return remove<{ success: true }>(`/admin/interface-publish/configs/${encodeURIComponent(configId)}`);
}
```

- [ ] **Step 4: 实现三字段弹窗和显式换 Token 状态**

The form state is:

```ts
type FormValues = { configName: string; externalBaseUrl: string; token?: string };
const [replacingToken, setReplacingToken] = useState(false);
```

Rules:

- Create mode always renders `Input.Password` and requires Token.
- Edit mode initially renders `Token 已配置` (or `Token 未配置`) and a `更换 Token` button.
- Only clicking `更换 Token` renders an empty `Input.Password`.
- Canceling replacement removes `token` from form state.
- Submit omits `token` in edit mode unless replacement is active and non-empty.
- Never set the old Token as an initial form value, placeholder, tooltip, mask fragment, DOM data attribute, or query cache field.

The submit branch must be explicit:

```ts
const common = {
  configName: values.configName.trim(),
  externalBaseUrl: values.externalBaseUrl.trim()
};
if (!config) return onSave({ mode: "create", payload: { ...common, token: values.token!.trim() } });
return onSave({
  mode: "update",
  configId: config.id,
  payload: replacingToken ? { ...common, token: values.token!.trim() } : common
});
```

- [ ] **Step 5: 运行前端静态测试和类型检查**

Run: `cd account-data-platform; bun test apps/web/tests/interface-publish-end-to-end.test.js && bun --filter @app/web typecheck`

Expected: PASS。

- [ ] **Step 6: 提交前端表单节点**

```bash
git add account-data-platform/apps/web/src/lib/api-client-interface-publish-configs.ts account-data-platform/apps/web/src/routes/InterfacePublishConfigModal.tsx account-data-platform/apps/web/tests/interface-publish-end-to-end.test.js
git commit -m "feat: add lightweight interface credential form"
```

### Task 11: 在“接口定时”页完成配置列表和唯一操作流

**Files:**
- Create: `account-data-platform/apps/web/src/routes/InterfacePublishConfigPanel.tsx`
- Modify: `account-data-platform/apps/web/src/routes/PublishSchedulesPage.tsx`
- Modify: `account-data-platform/apps/web/tests/interface-publish-end-to-end.test.js`
- Modify: `account-data-platform/apps/web/tests/publish-video-module.test.js`

- [ ] **Step 1: 写页面装配失败测试**

```js
for (const required of [
  "InterfacePublishConfigPanel",
  "InterfacePublishBindingsPanel",
  "InterfacePublishRunControl",
  "InterfacePublishRunMonitor"
]) assert(page.includes(required));

assert(!page.includes("RemoteScriptsContent"));
assert(!page.includes("getRemoteScriptConfigs"));
assert(!page.includes("Token 环境变量名"));

const order = [
  "InterfacePublishConfigPanel",
  "InterfacePublishBindingsPanel",
  "InterfacePublishRunControl",
  "InterfacePublishRunMonitor"
].map((symbol) => page.indexOf(symbol));
assert(order.every((value, index) => value >= 0 && (index === 0 || order[index - 1] < value)));
```

- [ ] **Step 2: 运行页面测试并确认失败**

Run: `cd account-data-platform; bun test apps/web/tests/interface-publish-end-to-end.test.js apps/web/tests/publish-video-module.test.js`

Expected: FAIL，页面仍使用 `RemoteScriptsContent`。

- [ ] **Step 3: 实现配置列表面板**

The panel receives `configs`, `loading`, and `onChanged`. It must provide:

- Header command `新建接口配置` with `PlusOutlined`.
- Columns: 配置名称、接口地址、Token 状态、启用状态、操作。
- Token tags: green `Token 已配置`, red `Token 未配置`.
- Action buttons: `测试连接`, icon edit, icon delete with tooltips.
- Disable test connection when `tokenConfigured` is false.
- Delete uses `Modal.confirm` and then invalidates `interfacePublishConfigQueryKey`.
- Mutations show backend messages; authentication failure says `认证失败，请更换 Token`; unreachable says `接口不可达，请检查接口地址、网络或 TLS`.

Do not nest this panel in another card. Reuse the existing `ops-panel` section style.

- [ ] **Step 4: 重组 `PublishSchedulesPage`**

Own the dedicated query in the page:

```tsx
const configsQuery = useQuery({
  queryKey: interfacePublishConfigQueryKey,
  queryFn: getInterfacePublishConfigs
});
const configs = configsQuery.data?.data ?? [];
```

Render in this order:

```tsx
<InterfacePublishConfigPanel
  configs={configs}
  loading={configsQuery.isLoading}
  onChanged={() => queryClient.invalidateQueries({ queryKey: interfacePublishConfigQueryKey })}
/>
<section className="ops-panel">
  <div className="ops-panel-head"><span>匹配设备</span></div>
  <div className="ops-panel-body"><InterfacePublishBindingsPanel /></div>
</section>
<InterfacePublishRunControl
  configs={configs
    .filter((item) => item.status === "ENABLED" && item.tokenConfigured)
    .map((item) => ({ id: item.id, name: item.configName }))}
/>
<InterfacePublishRunMonitor />
```

Remove `RemoteScriptsContent`, generic remote-script queries, generic modal language, and duplicate connection table. Keep run, binding and monitor components behavior unchanged.

- [ ] **Step 5: 运行前端测试、类型检查和构建**

Run: `cd account-data-platform; bun test apps/web/tests/interface-publish-end-to-end.test.js apps/web/tests/publish-video-module.test.js && bun --filter @app/web typecheck && bun --filter @app/web build:dev`

Expected: PASS；Vite build completes without warnings about duplicate keys or unused imports。

- [ ] **Step 6: 提交单页节点**

```bash
git add account-data-platform/apps/web/src/routes/InterfacePublishConfigPanel.tsx account-data-platform/apps/web/src/routes/PublishSchedulesPage.tsx account-data-platform/apps/web/tests/interface-publish-end-to-end.test.js account-data-platform/apps/web/tests/publish-video-module.test.js
git commit -m "feat: manage interface configs in scheduled publish page"
```

### Task 12: 环境说明、迁移、全量回归和浏览器验收

**Files:**
- Modify: `account-data-platform/.env.example`
- Modify: `account-data-platform/.env.development.example`
- Modify: `account-data-platform/.env.production.example`
- Modify: `account-data-platform/apps/api/src/integration/interface-publish-security.test.ts`

- [ ] **Step 1: 补充环境变量示例，不写真实密钥**

Add this comment and placeholder to all three example files:

```dotenv
# 32 random bytes encoded as canonical Base64; independent from JWT_SECRET.
PUBLISH_CREDENTIAL_ENCRYPTION_KEY=replace_with_32_byte_base64_key
```

In production example, place it with other required server secrets. Do not add the actual external Token or actual encryption key to a tracked file.

- [ ] **Step 2: 为当前开发环境生成一次独立密钥**

Run in PowerShell from `account-data-platform`:

```powershell
bun -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Expected: one canonical Base64 value representing 32 bytes. Put it only in the Git-ignored `.env.development` as `PUBLISH_CREDENTIAL_ENCRYPTION_KEY`. Confirm `git status --short` does not list `.env.development`.

- [ ] **Step 3: 应用迁移并核对表结构**

Run: `cd account-data-platform; bun run db:migrate`

Expected: migration `0031_publish_interface_credentials` succeeds.

Run this read-only query through the local PostgreSQL container:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'publish_interface_credentials'
ORDER BY ordinal_position;
```

Expected columns: `id`, `tenant_id`, `config_id`, `token_ciphertext`, `token_iv`, `token_auth_tag`, `key_version`, `created_at`, `updated_at`, `created_by`, `updated_by`.

- [ ] **Step 4: 运行完整自动化验证**

Run: `cd account-data-platform; bun test`

Expected: PASS。

Run: `cd account-data-platform; bun run typecheck && bun run build`

Expected: PASS。

Run: `cd account-data-platform; rg -n "ext_[0-9a-f]{32,}|Authorization.*Bearer.*ext_|tokenCiphertext|tokenAuthTag" apps/web/src ../mobile-agent/autojs --glob "!**/*.test.*"`

Expected: no matches。

Run: `cd account-data-platform; bun test apps/api/src/integration/interface-publish-security.test.ts apps/web/tests/interface-publish-end-to-end.test.js ../mobile-agent/autojs/tests/interface-publish-command-compatibility.test.js`

Expected: PASS；手机命令契约和成熟动作入口未改变。

- [ ] **Step 5: 启动服务并执行固定浏览器验收流程**

Start the existing development stack without changing its ports. Open `http://localhost:3024/publish-video`, select `接口定时`, then verify:

1. New configuration modal contains only 配置名称、接口地址、Token.
2. Saving closes the modal and list shows `Token 已配置`; refresh and browser restart do not ask for Token again.
3. Editing shows no old Token; changing only name preserves connection; clicking `更换 Token` allows replacement.
4. Test connection reports reachable/authentication/unreachable states without displaying Token.
5. Matching device, run control and monitor remain on the same page in the designed order.
6. A config with no database credential and no valid environment fallback cannot be selected for start; direct API start also returns the no-token error.
7. Delete asks for confirmation and removes the config from the list.
8. No console errors, failed React keys, overlapping controls, clipped text, or mobile-width horizontal page overflow.

Capture desktop 1440x900 and mobile 390x844 screenshots. Inspect the browser network panel: list responses contain `tokenConfigured` only and contain none of `token`, `externalTokenEnv`, `configPayload`, `tokenCiphertext`, `tokenIv`, or `tokenAuthTag`.

- [ ] **Step 6: 最终保护边界检查**

Run: `Get-FileHash 'C:\Users\21595\Documents\Codex\2026-08-05\dui\outputs\通过接口发布视频架构设计.md' -Algorithm SHA256`

Expected SHA-256: `D7536974D0E13068B8BA1A71D29BE3DB8491E371D1204EA327373C8A8E5FD50B`。

Run: `git diff -- mobile-agent/autojs/features/publish-video`

Expected: this feature adds no diff to the mature publish action scripts beyond pre-existing user changes.

- [ ] **Step 7: 提交环境说明和验收门禁**

```bash
git add account-data-platform/.env.example account-data-platform/.env.development.example account-data-platform/.env.production.example account-data-platform/apps/api/src/integration/interface-publish-security.test.ts
git commit -m "test: verify persisted interface publish credentials"
```

---

## 完成定义

- 专用 CRUD API 的任何响应、错误、日志均不含 Token 或加密材料。
- 新配置只需名称、URL、Token，技术参数由后端补齐。
- 编辑不换 Token 时原凭据保持不变；显式换 Token 后旧 Token 不再使用。
- 配置与凭据创建、更新、删除具有事务一致性。
- 测试连接、所有领取和所有状态 PATCH 均走同一个解析器。
- 数据库凭据优先，旧 `externalTokenEnv` 配置继续可用。
- “接口定时”是完整用户操作入口，页面关闭后配置仍存在。
- 外部接口契约、粘贴发布和手机成熟发布动作无行为变化。
- 全量测试、类型检查、构建、浏览器验收和保护文档哈希检查全部通过。
