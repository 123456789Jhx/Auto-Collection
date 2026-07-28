import { expect, test } from "bun:test";
import { app } from "../app";

test("GET /health returns ok", async () => {
  const response = await app.request("/health");
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.status).toBe("ok");
});
