import { describe, expect, test } from "bun:test";
import { resolveConfig } from "./config";

describe("api config", () => {
  test("development keeps local defaults", () => {
    const config = resolveConfig({});

    expect(config.jwtSecret).toBe("local-dev-jwt-secret");
    expect(config.adminUsername).toBe("root");
    expect(config.adminPassword).toBe("root");
    expect(config.mobileRequestSigningRequired).toBe(false);
    expect(config.legacyBusinessFrozen).toBe(false);
  });

  test("development does not enable mobile registration secret checks", () => {
    const config = resolveConfig({
      NODE_ENV: "development",
      MOBILE_REGISTRATION_SECRET: "legacy-local-secret"
    });

    expect(config.mobileRegistrationSecret).toBe("");
  });

  test("parses the legacy business freeze switch as a boolean", () => {
    expect(resolveConfig({ LEGACY_BUSINESS_FROZEN: "true" }).legacyBusinessFrozen).toBe(true);
    expect(resolveConfig({ LEGACY_BUSINESS_FROZEN: "TRUE" }).legacyBusinessFrozen).toBe(true);
    expect(resolveConfig({ LEGACY_BUSINESS_FROZEN: "false" }).legacyBusinessFrozen).toBe(false);
  });

  test("production rejects missing secrets", () => {
    expect(() => resolveConfig({ NODE_ENV: "production" })).toThrow(/JWT_SECRET/);
  });

  test("production accepts explicitly configured root admin password for the shared dev server", () => {
    const config = resolveConfig({
      NODE_ENV: "production",
      JWT_SECRET: "prod-jwt-secret-with-enough-length",
      ADMIN_PASSWORD: "root",
      MOBILE_REGISTRATION_SECRET: "prod-mobile-registration-secret",
      MOBILE_REQUEST_SIGNING_REQUIRED: "true"
    });

    expect(config.adminPassword).toBe("root");
  });

  test("production requires mobile request signing", () => {
    expect(() => resolveConfig({
      NODE_ENV: "production",
      JWT_SECRET: "prod-jwt-secret-with-enough-length",
      ADMIN_PASSWORD: "prod-admin-password",
      MOBILE_REGISTRATION_SECRET: "prod-mobile-registration-secret",
      MOBILE_REQUEST_SIGNING_REQUIRED: "false"
    })).toThrow(/MOBILE_REQUEST_SIGNING_REQUIRED/);
  });

  test("production accepts explicit strong secrets", () => {
    const config = resolveConfig({
      NODE_ENV: "production",
      JWT_SECRET: "prod-jwt-secret-with-enough-length",
      ADMIN_USERNAME: "root",
      ADMIN_PASSWORD: "prod-admin-password",
      MOBILE_REGISTRATION_SECRET: "prod-mobile-registration-secret",
      MOBILE_REQUEST_SIGNING_REQUIRED: "true"
    });

    expect(config.jwtSecret).toBe("prod-jwt-secret-with-enough-length");
    expect(config.adminPassword).toBe("prod-admin-password");
    expect(config.mobileRegistrationSecret).toBe("prod-mobile-registration-secret");
    expect(config.mobileRequestSigningRequired).toBe(true);
  });
});
