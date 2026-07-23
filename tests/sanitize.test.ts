import { test, expect } from "bun:test";
import { sanitize } from "../src/applescript.ts";

test("escapes script-sensitive characters and removes null bytes", () => {
  expect(sanitize("\\\"\n\r\t\0")).toBe("\\\\\\\"\\n\\r\\t");
});

test("escapes every quote in a representative injection payload", () => {
  const payload = `"; app.doShellScript("x"); "`;

  expect(sanitize(payload)).toBe(
    `\\"; app.doShellScript(\\"x\\"); \\"`,
  );
});
