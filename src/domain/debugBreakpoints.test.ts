import { describe, expect, it } from "vitest";
import type { Breakpoint } from "./debug";
import {
  applyVerification,
  breakpointsForFile,
  deserializeBreakpoints,
  removeBreakpoint,
  sequentialBreakpointIdFactory,
  serializeBreakpoints,
  setBreakpointCondition,
  setBreakpointEnabled,
  shiftBreakpointsForEdit,
  toggleBreakpoint,
} from "./debugBreakpoints";

function breakpoint(
  id: string,
  filePath: string,
  lineNumber: number,
  overrides: Partial<Breakpoint> = {},
): Breakpoint {
  return { id, filePath, lineNumber, enabled: true, ...overrides };
}

describe("sequentialBreakpointIdFactory", () => {
  it("produces deterministic incrementing ids", () => {
    const createId = sequentialBreakpointIdFactory();

    expect([createId(), createId(), createId()]).toEqual([
      "bp-1",
      "bp-2",
      "bp-3",
    ]);
  });

  it("continues from an injected start value", () => {
    const createId = sequentialBreakpointIdFactory(41);

    expect([createId(), createId()]).toEqual(["bp-41", "bp-42"]);
  });
});

describe("toggleBreakpoint", () => {
  it("adds an enabled breakpoint with a factory-issued id", () => {
    const list = toggleBreakpoint(
      [],
      "/a.ts",
      5,
      sequentialBreakpointIdFactory(),
    );

    expect(list).toEqual([breakpoint("bp-1", "/a.ts", 5)]);
  });

  it("removes an existing breakpoint on the same file and line", () => {
    const createId = sequentialBreakpointIdFactory();
    const added = toggleBreakpoint([], "/a.ts", 5, createId);
    const toggled = toggleBreakpoint(added, "/a.ts", 5, createId);

    expect(toggled).toEqual([]);
  });

  it("keeps breakpoints on other lines and files intact", () => {
    const createId = sequentialBreakpointIdFactory();
    let list = toggleBreakpoint([], "/a.ts", 5, createId);
    list = toggleBreakpoint(list, "/a.ts", 9, createId);
    list = toggleBreakpoint(list, "/b.ts", 5, createId);
    list = toggleBreakpoint(list, "/a.ts", 5, createId);

    expect(list).toEqual([
      breakpoint("bp-2", "/a.ts", 9),
      breakpoint("bp-3", "/b.ts", 5),
    ]);
  });

  it("does not mutate the input list", () => {
    const original = [breakpoint("bp-1", "/a.ts", 5)];
    toggleBreakpoint(original, "/a.ts", 9, sequentialBreakpointIdFactory(2));

    expect(original).toEqual([breakpoint("bp-1", "/a.ts", 5)]);
  });
});

describe("setBreakpointEnabled", () => {
  it("toggles the enabled flag for the matching id only", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5),
      breakpoint("bp-2", "/a.ts", 9),
    ];

    const disabled = setBreakpointEnabled(list, "bp-1", false);

    expect(disabled).toEqual([
      breakpoint("bp-1", "/a.ts", 5, { enabled: false }),
      breakpoint("bp-2", "/a.ts", 9),
    ]);
  });

  it("is a no-op for an unknown id", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5)];

    expect(setBreakpointEnabled(list, "missing", false)).toEqual(list);
  });
});

describe("setBreakpointCondition", () => {
  it("sets a condition on the matching breakpoint", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5)];

    expect(setBreakpointCondition(list, "bp-1", "count > 3")).toEqual([
      breakpoint("bp-1", "/a.ts", 5, { condition: "count > 3" }),
    ]);
  });

  it("clears the condition when given null", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5, { condition: "count > 3" }),
    ];

    const cleared = setBreakpointCondition(list, "bp-1", null);

    expect(cleared).toEqual([breakpoint("bp-1", "/a.ts", 5)]);
    expect("condition" in cleared[0]).toBe(false);
  });

  it("clears the condition when given a blank string", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5, { condition: "count > 3" }),
    ];

    expect(setBreakpointCondition(list, "bp-1", "   ")).toEqual([
      breakpoint("bp-1", "/a.ts", 5),
    ]);
  });
});

describe("removeBreakpoint", () => {
  it("removes the breakpoint with the matching id", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5),
      breakpoint("bp-2", "/a.ts", 9),
    ];

    expect(removeBreakpoint(list, "bp-1")).toEqual([
      breakpoint("bp-2", "/a.ts", 9),
    ]);
  });
});

describe("breakpointsForFile", () => {
  it("returns only the file's breakpoints sorted by line", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 9),
      breakpoint("bp-2", "/b.ts", 1),
      breakpoint("bp-3", "/a.ts", 5),
    ];

    expect(breakpointsForFile(list, "/a.ts")).toEqual([
      breakpoint("bp-3", "/a.ts", 5),
      breakpoint("bp-1", "/a.ts", 9),
    ]);
  });
});

describe("applyVerification", () => {
  it("marks matched breakpoints verified and adopts the adjusted line", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5),
      breakpoint("bp-2", "/a.ts", 9),
    ];
    const verified = [
      breakpoint("bp-1", "/a.ts", 6, { verified: true }),
    ];

    expect(applyVerification(list, "/a.ts", verified)).toEqual([
      breakpoint("bp-1", "/a.ts", 6, { verified: true }),
      breakpoint("bp-2", "/a.ts", 9, { verified: false }),
    ]);
  });

  it("treats a verified entry without an explicit flag as verified", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5)];

    expect(applyVerification(list, "/a.ts", [breakpoint("bp-1", "/a.ts", 5)])).toEqual(
      [breakpoint("bp-1", "/a.ts", 5, { verified: true })],
    );
  });

  it("collapses breakpoints that verification moves onto an occupied line", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5),
      breakpoint("bp-2", "/a.ts", 6),
    ];
    const verified = [
      breakpoint("bp-1", "/a.ts", 6, { verified: true }),
      breakpoint("bp-2", "/a.ts", 6, { verified: true }),
    ];

    expect(applyVerification(list, "/a.ts", verified)).toEqual([
      breakpoint("bp-1", "/a.ts", 6, { verified: true }),
    ]);
  });

  it("keeps one breakpoint per line even when the collided one is unverified", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5),
      breakpoint("bp-2", "/a.ts", 6),
    ];
    const verified = [breakpoint("bp-1", "/a.ts", 6, { verified: true })];

    expect(applyVerification(list, "/a.ts", verified)).toEqual([
      breakpoint("bp-1", "/a.ts", 6, { verified: true }),
    ]);
  });

  it("does not dedupe lines across different files", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5),
      breakpoint("bp-2", "/b.ts", 6),
    ];
    const verified = [breakpoint("bp-1", "/a.ts", 6, { verified: true })];

    expect(applyVerification(list, "/a.ts", verified)).toEqual([
      breakpoint("bp-1", "/a.ts", 6, { verified: true }),
      breakpoint("bp-2", "/b.ts", 6),
    ]);
  });

  it("leaves breakpoints of other files untouched", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5),
      breakpoint("bp-2", "/b.ts", 3),
    ];

    expect(applyVerification(list, "/a.ts", [])).toEqual([
      breakpoint("bp-1", "/a.ts", 5, { verified: false }),
      breakpoint("bp-2", "/b.ts", 3),
    ]);
  });
});

describe("shiftBreakpointsForEdit", () => {
  it("shifts breakpoints at and below an insertion point down", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 4),
      breakpoint("bp-2", "/a.ts", 5),
      breakpoint("bp-3", "/a.ts", 10),
    ];

    expect(shiftBreakpointsForEdit(list, "/a.ts", 5, 2)).toEqual([
      breakpoint("bp-1", "/a.ts", 4),
      breakpoint("bp-2", "/a.ts", 7),
      breakpoint("bp-3", "/a.ts", 12),
    ]);
  });

  it("removes breakpoints inside a deleted range and shifts the rest up", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 4),
      breakpoint("bp-2", "/a.ts", 5),
      breakpoint("bp-3", "/a.ts", 6),
      breakpoint("bp-4", "/a.ts", 7),
    ];

    expect(shiftBreakpointsForEdit(list, "/a.ts", 5, -2)).toEqual([
      breakpoint("bp-1", "/a.ts", 4),
      breakpoint("bp-4", "/a.ts", 5),
    ]);
  });

  it("keeps the first line after the deleted range on the deletion start line", () => {
    const list = [breakpoint("bp-1", "/a.ts", 8)];

    expect(shiftBreakpointsForEdit(list, "/a.ts", 5, -3)).toEqual([
      breakpoint("bp-1", "/a.ts", 5),
    ]);
  });

  it("ignores other files and a zero delta", () => {
    const list = [breakpoint("bp-1", "/b.ts", 10)];

    expect(shiftBreakpointsForEdit(list, "/a.ts", 5, 3)).toEqual(list);
    expect(shiftBreakpointsForEdit(list, "/b.ts", 5, 0)).toEqual(list);
  });

  it("preserves breakpoint identity across shifts", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5, { condition: "x > 1" })];

    const shifted = shiftBreakpointsForEdit(list, "/a.ts", 3, 4);

    expect(shifted).toEqual([
      breakpoint("bp-1", "/a.ts", 9, { condition: "x > 1" }),
    ]);
  });

  it("does not mutate the input list", () => {
    const original = [breakpoint("bp-1", "/a.ts", 10)];
    shiftBreakpointsForEdit(original, "/a.ts", 5, 2);

    expect(original).toEqual([breakpoint("bp-1", "/a.ts", 10)]);
  });

  it("never merges two breakpoints onto one line", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 4),
      breakpoint("bp-2", "/a.ts", 5),
      breakpoint("bp-3", "/a.ts", 8),
    ];

    const afterInsert = shiftBreakpointsForEdit(list, "/a.ts", 5, 3);
    const afterDelete = shiftBreakpointsForEdit(list, "/a.ts", 5, -3);

    expect(afterInsert).toEqual([
      breakpoint("bp-1", "/a.ts", 4),
      breakpoint("bp-2", "/a.ts", 8),
      breakpoint("bp-3", "/a.ts", 11),
    ]);
    expect(afterDelete).toEqual([
      breakpoint("bp-1", "/a.ts", 4),
      breakpoint("bp-3", "/a.ts", 5),
    ]);
    expect(new Set(afterInsert.map((entry) => entry.lineNumber)).size).toBe(
      afterInsert.length,
    );
    expect(new Set(afterDelete.map((entry) => entry.lineNumber)).size).toBe(
      afterDelete.length,
    );
  });

  it("clamps shifted lines to line 1", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 1),
      breakpoint("bp-2", "/a.ts", 2),
    ];

    expect(shiftBreakpointsForEdit(list, "/a.ts", 0, -2)).toEqual([
      breakpoint("bp-2", "/a.ts", 1),
    ]);
  });
});

describe("serializeBreakpoints / deserializeBreakpoints", () => {
  it("round-trips ids, locations, conditions and enabled flags", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5, { condition: "x > 1", enabled: false }),
      breakpoint("bp-2", "/b.ts", 9),
    ];

    expect(deserializeBreakpoints(serializeBreakpoints(list))).toEqual(list);
  });

  it("strips session-scoped verification on serialize", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5, { verified: true })];

    const restored = deserializeBreakpoints(serializeBreakpoints(list));

    expect(restored).toEqual([breakpoint("bp-1", "/a.ts", 5)]);
    expect("verified" in restored[0]).toBe(false);
  });

  it("returns an empty list for invalid JSON", () => {
    expect(deserializeBreakpoints("not json {")).toEqual([]);
  });

  it("returns an empty list for non-array payloads", () => {
    expect(deserializeBreakpoints('{"id":"bp-1"}')).toEqual([]);
    expect(deserializeBreakpoints("null")).toEqual([]);
    expect(deserializeBreakpoints('"bp-1"')).toEqual([]);
  });

  it("drops malformed entries and keeps valid ones", () => {
    const raw = JSON.stringify([
      { id: "bp-1", filePath: "/a.ts", lineNumber: 5, enabled: true },
      { id: "", filePath: "/a.ts", lineNumber: 5, enabled: true },
      { id: "bp-2", filePath: "/a.ts", lineNumber: 0, enabled: true },
      { id: "bp-3", filePath: "/a.ts", lineNumber: 2.5, enabled: true },
      { id: "bp-4", filePath: "/a.ts", lineNumber: 5 },
      { id: "bp-5", filePath: 42, lineNumber: 5, enabled: true },
      "garbage",
      null,
      { id: "bp-6", filePath: "/b.ts", lineNumber: 3, enabled: false, condition: "y" },
    ]);

    expect(deserializeBreakpoints(raw)).toEqual([
      breakpoint("bp-1", "/a.ts", 5),
      breakpoint("bp-6", "/b.ts", 3, { enabled: false, condition: "y" }),
    ]);
  });

  it("ignores a non-string condition instead of rejecting the entry", () => {
    const raw = JSON.stringify([
      { id: "bp-1", filePath: "/a.ts", lineNumber: 5, enabled: true, condition: 7 },
    ]);

    expect(deserializeBreakpoints(raw)).toEqual([
      breakpoint("bp-1", "/a.ts", 5),
    ]);
  });
});
