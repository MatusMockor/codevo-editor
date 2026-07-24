import { describe, expect, it } from "vitest";
import {
  MAX_JS_TEST_OUTPUT_STREAM_BYTES,
  MAX_JS_TEST_TASK_ID_BYTES,
  validatedJsTestTaskRunId,
  validatedJsTestTaskWorkspaceId,
} from "./jsTestTask";

describe("JavaScript test task IDs", () => {
  it("publishes the exact per-stream output byte budget", () => {
    expect(MAX_JS_TEST_OUTPUT_STREAM_BYTES).toBe(65_536);
  });

  it.each([
    ["runId", validatedJsTestTaskRunId],
    ["workspaceId", validatedJsTestTaskWorkspaceId],
  ] as const)(
    "accepts opaque %s values at the 64-byte boundary without normalizing them",
    (_, validate) => {
      const spacesAreOpaque = "  task id  ";
      expect(validate(spacesAreOpaque)).toBe(spacesAreOpaque);
      expect(validate("x".repeat(MAX_JS_TEST_TASK_ID_BYTES))).toHaveLength(
        MAX_JS_TEST_TASK_ID_BYTES,
      );
      expect(validate("🙂".repeat(MAX_JS_TEST_TASK_ID_BYTES / 4))).toBe(
        "🙂".repeat(MAX_JS_TEST_TASK_ID_BYTES / 4),
      );
    },
  );

  it.each([
    ["runId", validatedJsTestTaskRunId],
    ["workspaceId", validatedJsTestTaskWorkspaceId],
  ] as const)(
    "rejects empty, oversized, control-bearing, malformed, and non-string %s values",
    (_, validate) => {
      for (const value of [
        "",
        "   ",
        "x".repeat(MAX_JS_TEST_TASK_ID_BYTES + 1),
        "🙂".repeat(MAX_JS_TEST_TASK_ID_BYTES / 4 + 1),
        "line\nbreak",
        "nul\u0000byte",
        String.fromCharCode(0xd800),
        42,
      ]) {
        expect(() => validate(value as string)).toThrow(/JavaScript test task/);
      }
    },
  );
});
