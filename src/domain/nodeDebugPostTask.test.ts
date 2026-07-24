import { describe, expect, it } from "vitest";
import {
  MAX_NODE_DEBUG_POST_TASK_LABEL_BYTES,
  validateNodeDebugPostTask,
} from "./nodeDebugPostTask";

describe("validateNodeDebugPostTask", () => {
  it("creates an immutable exact-label value object", () => {
    const result = validateNodeDebugPostTask("stop api");

    expect(result).toEqual({
      kind: "valid",
      task: { label: "stop api" },
    });
    expect(result.kind === "valid" && Object.isFrozen(result.task)).toBe(true);
  });

  it("distinguishes absent metadata from invalid metadata", () => {
    expect(validateNodeDebugPostTask(undefined)).toEqual({ kind: "none" });
    expect(validateNodeDebugPostTask("")).toMatchObject({ kind: "invalid" });
  });

  it.each([
    [" padded", "leading whitespace"],
    ["trailing ", "trailing whitespace"],
    ["stop\u0000api", "control character"],
    ["stop\u202eapi", "bidirectional override"],
    ["x".repeat(MAX_NODE_DEBUG_POST_TASK_LABEL_BYTES + 1), "oversized label"],
  ])("rejects %s as an unsafe exact task label (%s)", (value) => {
    expect(validateNodeDebugPostTask(value)).toEqual({
      kind: "invalid",
      message: expect.stringContaining("postDebugTask"),
    });
  });
});
