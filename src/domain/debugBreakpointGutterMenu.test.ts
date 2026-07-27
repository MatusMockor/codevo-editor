import { describe, expect, it } from "vitest";
import type { Breakpoint } from "./debug";
import {
  debugBreakpointConditionValue,
  debugBreakpointGutterCapabilities,
  debugBreakpointGutterMenuItems,
} from "./debugBreakpointGutterMenu";

const rootPath = "/workspace";
const filePath = "/workspace/app.ts";

function breakpoint(overrides: Partial<Breakpoint> = {}): Breakpoint {
  return {
    enabled: true,
    filePath,
    id: "breakpoint-1",
    lineNumber: 7,
    ...overrides,
  };
}

describe("debugBreakpointGutterMenu", () => {
  it("returns every creation action, including hit count", () => {
    const capabilities = debugBreakpointGutterCapabilities(rootPath, filePath);

    expect(debugBreakpointGutterMenuItems(null, capabilities)).toEqual([
      { id: "add", label: "Add Breakpoint" },
      { id: "addConditional", label: "Add Conditional Breakpoint..." },
      { id: "addHitCondition", label: "Add Hit Count..." },
      { id: "addLogpoint", label: "Add Logpoint..." },
    ]);
  });

  it("returns conditional, hit-count, logpoint, removal, and enabled-state actions", () => {
    const capabilities = debugBreakpointGutterCapabilities(rootPath, filePath);

    expect(
      debugBreakpointGutterMenuItems(
        breakpoint({
          condition: "ready",
          hitCondition: { count: 3, kind: "equals" },
          logMessage: "value={value}",
        }),
        capabilities,
      ),
    ).toEqual([
      { id: "editConditional", label: "Edit Conditional Breakpoint..." },
      { id: "editHitCondition", label: "Edit Hit Count..." },
      { id: "editLogpoint", label: "Edit Logpoint..." },
      { id: "removeLogpoint", label: "Remove Logpoint" },
      { id: "remove", label: "Remove Breakpoint" },
      { id: "disable", label: "Disable Breakpoint" },
    ]);
  });

  it("maps empty conditional input to null and trims non-empty input", () => {
    expect(debugBreakpointConditionValue("   ")).toBeNull();
    expect(debugBreakpointConditionValue("  value > 2  ")).toBe("value > 2");
  });

  it("makes Node-only actions unavailable for PHP documents", () => {
    const capabilities = debugBreakpointGutterCapabilities(rootPath, "/workspace/app.php");

    expect(capabilities.logpoints).toBe(false);
    expect(capabilities.hitConditions).toBe(false);
    expect(debugBreakpointGutterMenuItems(null, capabilities)).toEqual([
      { id: "add", label: "Add Breakpoint" },
      { id: "addConditional", label: "Add Conditional Breakpoint..." },
    ]);
  });

  it("fails closed for paths outside the workspace and unknown document types", () => {
    expect(debugBreakpointGutterCapabilities(rootPath, "/other/app.ts")).toEqual({
      breakpoints: false,
      hitConditions: false,
      logpoints: false,
    });
    expect(debugBreakpointGutterCapabilities(rootPath, "/workspace/app.txt")).toEqual({
      breakpoints: false,
      hitConditions: false,
      logpoints: false,
    });
  });
});
