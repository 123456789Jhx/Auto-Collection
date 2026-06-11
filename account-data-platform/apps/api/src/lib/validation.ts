import type { Context } from "hono";
import type { ZodError } from "zod";

export function validationError(c: Context, error: ZodError) {
  return c.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "参数不合法",
        details: error.flatten()
      }
    },
    400
  );
}
