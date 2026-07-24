import { describe, expect, it } from "vitest";
import { vscodeProcessTaskDependencySummary } from "./vscodeProcessTaskDependencySummary";

describe("vscodeProcessTaskDependencySummary", () => {
  it("omits an empty dependency summary", () => {
    expect(vscodeProcessTaskDependencySummary([])).toBeNull();
  });

  it("preserves declared dependency order", () => {
    expect(vscodeProcessTaskDependencySummary(["Generate", "Typecheck"])).toBe(
      "Runs after: Generate, Typecheck",
    );
  });

  it("bounds long dependency lists and reports the hidden count", () => {
    expect(vscodeProcessTaskDependencySummary(["A", "B", "C", "D", "E"])).toBe(
      "Runs after: A, B, C (+2 more)",
    );
  });
});
