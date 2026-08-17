import { z } from "zod";
import { remoteWakeCommandTypeSchema } from "./remote-wake";

export const remoteWakeCommandSchema = z.object({
  commandType: remoteWakeCommandTypeSchema,
  commandId: z.string().uuid(),
  deviceId: z.string().trim().min(1),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true })
}).superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "remote_wake_expiry_must_follow_issue_time"
    });
  }
});

export type RemoteWakeCommand = z.infer<typeof remoteWakeCommandSchema>;
