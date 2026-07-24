import { describe, expect, it } from "vitest";
import {
  MAX_NODE_DEBUG_PRE_LAUNCH_TASK_LABEL_BYTES,
  validateNodeDebugPreLaunchTask,
} from "./nodeDebugPreLaunchTask";

describe("validateNodeDebugPreLaunchTask", () => {
  it("preserves an exact optional process-task label", () => {
    expect(validateNodeDebugPreLaunchTask(undefined)).toEqual({ kind: "none" });
    expect(validateNodeDebugPreLaunchTask("Build app")).toEqual({
      kind: "valid",
      task: { label: "Build app" },
    });
  });

  it.each([
    null,
    1,
    "",
    " Build",
    "Build ",
    "Build\napp",
    "Build\u007fapp",
    "Build\u2028app",
    "Build\u202eapp",
    "Build\u2066app",
    "x".repeat(MAX_NODE_DEBUG_PRE_LAUNCH_TASK_LABEL_BYTES + 1),
  ])("rejects unsafe or ambiguous metadata without normalizing it: %j", (value) => {
    expect(validateNodeDebugPreLaunchTask(value)).toMatchObject({ kind: "invalid" });
  });

  it("bounds UTF-8 bytes rather than UTF-16 code units", () => {
    expect(validateNodeDebugPreLaunchTask("€".repeat(86))).toMatchObject({ kind: "invalid" });
  });
});
