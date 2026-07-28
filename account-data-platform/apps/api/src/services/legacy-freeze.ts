import type { Context } from "hono";
import { config } from "../config";

const legacyCollectionCommandTypes = new Set(["START", "PAUSE", "RESUME", "STOP"]);

function frozenResponse(c: Context) {
  return c.json({
    error: {
      code: "LEGACY_BUSINESS_FROZEN",
      message: "旧采集业务已冻结",
      details: {}
    }
  }, 409);
}

export function guardLegacyMobileCommand(
  c: Context,
  payload: unknown,
  frozen = config.legacyBusinessFrozen
) {
  const commandType = payload && typeof payload === "object" && "commandType" in payload
    ? payload.commandType
    : payload;
  if (!frozen || typeof commandType !== "string" || !legacyCollectionCommandTypes.has(commandType)) {
    return undefined;
  }
  return frozenResponse(c);
}

export function guardLegacyTaskAssignment(c: Context, frozen = config.legacyBusinessFrozen) {
  return frozen ? frozenResponse(c) : undefined;
}
