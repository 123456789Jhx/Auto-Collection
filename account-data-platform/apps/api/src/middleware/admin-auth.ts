import type { Context, Next } from "hono";
import { verifyAdminToken, type AdminSession } from "../services/auth.service";

export type AdminVariables = {
  admin: AdminSession;
};

export async function adminAuth(c: Context<{ Variables: AdminVariables }>, next: Next) {
  const authorization = c.req.header("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return c.json({ error: { code: "ADMIN_AUTH_REQUIRED", message: "Admin login is required", details: {} } }, 401);
  }

  const admin = verifyAdminToken(token);
  if (!admin) {
    return c.json({ error: { code: "ADMIN_TOKEN_INVALID", message: "Admin token is invalid or expired", details: {} } }, 401);
  }

  c.set("admin", admin);
  await next();
}
