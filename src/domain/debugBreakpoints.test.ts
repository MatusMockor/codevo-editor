import { describe, expect, it } from "vitest";
import type { Breakpoint } from "./debug";
import {
  addBreakpoint,
  applyVerification,
  breakpointsForFile,
  clearBreakpoints,
  countBreakpoints,
  deserializeBreakpoints,
  removeBreakpoint,
  relocateBreakpoint,
  sequentialBreakpointIdFactory,
  serializeBreakpoints,
  setBreakpointCondition,
  setBreakpointEnabled,
  setBreakpointHitCondition,
  setBreakpointLogMessage,
  setAllBreakpointsEnabled,
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

    expect([createId(), createId(), createId()]).toEqual(["bp-1", "bp-2", "bp-3"]);
  });

  it("continues from an injected start value", () => {
    const createId = sequentialBreakpointIdFactory(41);

    expect([createId(), createId()]).toEqual(["bp-41", "bp-42"]);
  });
});

describe("toggleBreakpoint", () => {
  it("adds an enabled breakpoint with a factory-issued id", () => {
    const list = toggleBreakpoint([], "/a.ts", 5, sequentialBreakpointIdFactory());

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

    expect(list).toEqual([breakpoint("bp-2", "/a.ts", 9), breakpoint("bp-3", "/b.ts", 5)]);
  });

  it("does not mutate the input list", () => {
    const original = [breakpoint("bp-1", "/a.ts", 5)];
    toggleBreakpoint(original, "/a.ts", 9, sequentialBreakpointIdFactory(2));

    expect(original).toEqual([breakpoint("bp-1", "/a.ts", 5)]);
  });

  it("toggles only the line breakpoint and preserves inline siblings", () => {
    const inline = breakpoint("inline", "/a.ts", 5, { columnNumber: 7 });
    const withLine = toggleBreakpoint([inline], "/a.ts", 5, () => "line");

    expect(withLine).toEqual([inline, breakpoint("line", "/a.ts", 5)]);
    expect(toggleBreakpoint(withLine, "/a.ts", 5, () => "unused")).toEqual([inline]);
  });
});

describe("addBreakpoint", () => {
  it("is add-only for the exact tuple while allowing line and inline siblings", () => {
    const line = breakpoint("line", "/a.ts", 5);
    const inline = addBreakpoint(
      [line],
      { filePath: "/a.ts", lineNumber: 5, columnNumber: 7 },
      () => "inline",
    );

    expect(inline).toEqual([line, breakpoint("inline", "/a.ts", 5, { columnNumber: 7 })]);
    expect(
      addBreakpoint(inline, { filePath: "/a.ts", lineNumber: 5, columnNumber: 7 }, () => "unused"),
    ).toBe(inline);
  });
});

describe("relocateBreakpoint", () => {
  it("preserves entity metadata while moving only the exact id", () => {
    const source = breakpoint("inline", "/a.ts", 4, {
      columnNumber: 7,
      condition: "ready",
      enabled: false,
      logMessage: "value={value}",
      verified: true,
    });
    expect(
      relocateBreakpoint([source], "inline", {
        columnNumber: 9,
        filePath: "/a.ts",
        lineNumber: 5,
      }),
    ).toEqual([{ ...source, columnNumber: 9, lineNumber: 5 }]);
  });

  it("rejects semantic-kind changes and exact tuple collisions", () => {
    const line = breakpoint("line", "/a.ts", 4);
    const inline = breakpoint("inline", "/a.ts", 4, { columnNumber: 7 });
    expect(
      relocateBreakpoint([line, inline], "inline", { filePath: "/a.ts", lineNumber: 5 }),
    ).toEqual([line, inline]);
    expect(
      relocateBreakpoint([line, inline], "inline", {
        columnNumber: 1,
        filePath: "/a.ts",
        lineNumber: 4,
      }),
    ).toEqual([line, { ...inline, columnNumber: 1 }]);
    const other = breakpoint("other", "/a.ts", 5, { columnNumber: 9 });
    expect(
      relocateBreakpoint([inline, other], "inline", {
        columnNumber: 9,
        filePath: "/a.ts",
        lineNumber: 5,
      }),
    ).toEqual([inline, other]);
  });
});

describe("setBreakpointEnabled", () => {
  it("toggles the enabled flag for the matching id only", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5), breakpoint("bp-2", "/a.ts", 9)];

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

describe("bulk breakpoint transforms", () => {
  it("counts enabled and disabled breakpoints without changing the input", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5),
      breakpoint("bp-2", "/a.ts", 9, { enabled: false }),
      breakpoint("bp-3", "/b.ts", 2),
    ];

    expect(countBreakpoints(list)).toEqual({ disabled: 1, enabled: 2 });
    expect(list[1]?.enabled).toBe(false);
  });

  it("enables or disables every breakpoint immutably and preserves no-op identity", () => {
    const enabled = [breakpoint("bp-1", "/a.ts", 5), breakpoint("bp-2", "/b.ts", 2)];
    const disabled = setAllBreakpointsEnabled(enabled, false);

    expect(disabled).toEqual(enabled.map((entry) => ({ ...entry, enabled: false })));
    expect(disabled).not.toBe(enabled);
    expect(disabled[0]).not.toBe(enabled[0]);
    expect(setAllBreakpointsEnabled(disabled, false)).toBe(disabled);
    expect(setAllBreakpointsEnabled([], true)).toEqual([]);
  });

  it("clears a populated list and preserves an empty list as a no-op", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5)];
    const empty: Breakpoint[] = [];

    expect(clearBreakpoints(list)).toEqual([]);
    expect(list).toHaveLength(1);
    expect(clearBreakpoints(empty)).toBe(empty);
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
    const list = [breakpoint("bp-1", "/a.ts", 5, { condition: "count > 3" })];

    const cleared = setBreakpointCondition(list, "bp-1", null);

    expect(cleared).toEqual([breakpoint("bp-1", "/a.ts", 5)]);
    expect("condition" in cleared[0]).toBe(false);
  });

  it("clears the condition when given a blank string", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5, { condition: "count > 3" })];

    expect(setBreakpointCondition(list, "bp-1", "   ")).toEqual([breakpoint("bp-1", "/a.ts", 5)]);
  });

  it("keeps the previous condition when the replacement exceeds the wire bound", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5, { condition: "safe" })];
    expect(setBreakpointCondition(list, "bp-1", "é".repeat(2_049))).toEqual(list);
  });
});

describe("setBreakpointHitCondition", () => {
  it("sets and clears a typed hit condition without changing other breakpoints", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5), breakpoint("bp-2", "/a.ts", 9)];
    const hitCondition = { kind: "greaterOrEqual", count: 4 } as const;

    const updated = setBreakpointHitCondition(list, "bp-1", hitCondition);
    expect(updated).toEqual([
      breakpoint("bp-1", "/a.ts", 5, { hitCondition }),
      breakpoint("bp-2", "/a.ts", 9),
    ]);

    const cleared = setBreakpointHitCondition(updated, "bp-1", null);
    expect(cleared).toEqual(list);
    expect("hitCondition" in cleared[0]).toBe(false);
  });

  it("keeps the previous value for an invalid runtime value", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5, { hitCondition: { kind: "equals", count: 2 } })];
    expect(setBreakpointHitCondition(list, "bp-1", { kind: "equals", count: 0 } as never)).toEqual(
      list,
    );
  });
});

describe("setBreakpointLogMessage", () => {
  it("composes a logpoint with condition and hit condition, then clears only the message", () => {
    const base = breakpoint("bp-1", "/a.ts", 5, {
      condition: "enabled",
      hitCondition: { kind: "multiple", count: 3 },
    });
    const updated = setBreakpointLogMessage([base], "bp-1", "count={count}");
    expect(updated).toEqual([{ ...base, logMessage: "count={count}" }]);

    const cleared = setBreakpointLogMessage(updated, "bp-1", "  ");
    expect(cleared).toEqual([base]);
    expect("logMessage" in cleared[0]).toBe(false);
  });

  it("keeps the prior breakpoint for a malformed or oversized message", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5, { logMessage: "safe={value}" })];
    expect(setBreakpointLogMessage(list, "bp-1", "value={")).toEqual(list);
    expect(setBreakpointLogMessage(list, "bp-1", "é".repeat(2_049))).toEqual(list);
  });
});

describe("removeBreakpoint", () => {
  it("removes the breakpoint with the matching id", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5), breakpoint("bp-2", "/a.ts", 9)];

    expect(removeBreakpoint(list, "bp-1")).toEqual([breakpoint("bp-2", "/a.ts", 9)]);
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
  it("marks matched breakpoints verified without replacing the requested location", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5), breakpoint("bp-2", "/a.ts", 9)];
    const verified = [breakpoint("bp-1", "/a.ts", 6, { verified: true })];

    expect(applyVerification(list, "/a.ts", verified)).toEqual([
      breakpoint("bp-1", "/a.ts", 5, { verified: true }),
      breakpoint("bp-2", "/a.ts", 9, { verified: false }),
    ]);
  });

  it("treats a verified entry without an explicit flag as verified", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5)];

    expect(applyVerification(list, "/a.ts", [breakpoint("bp-1", "/a.ts", 5)])).toEqual([
      breakpoint("bp-1", "/a.ts", 5, { verified: true }),
    ]);
  });

  it("preserves requested siblings when verification reports one resolved line", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5), breakpoint("bp-2", "/a.ts", 6)];
    const verified = [
      breakpoint("bp-1", "/a.ts", 6, { verified: true }),
      breakpoint("bp-2", "/a.ts", 6, { verified: true }),
    ];

    expect(applyVerification(list, "/a.ts", verified)).toEqual([
      breakpoint("bp-1", "/a.ts", 5, { verified: true }),
      breakpoint("bp-2", "/a.ts", 6, { verified: true }),
    ]);
  });

  it("preserves an unverified requested sibling", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5), breakpoint("bp-2", "/a.ts", 6)];
    const verified = [breakpoint("bp-1", "/a.ts", 6, { verified: true })];

    expect(applyVerification(list, "/a.ts", verified)).toEqual([
      breakpoint("bp-1", "/a.ts", 5, { verified: true }),
      breakpoint("bp-2", "/a.ts", 6, { verified: false }),
    ]);
  });

  it("does not dedupe lines across different files", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5), breakpoint("bp-2", "/b.ts", 6)];
    const verified = [breakpoint("bp-1", "/a.ts", 6, { verified: true })];

    expect(applyVerification(list, "/a.ts", verified)).toEqual([
      breakpoint("bp-1", "/a.ts", 5, { verified: true }),
      breakpoint("bp-2", "/b.ts", 6),
    ]);
  });

  it("leaves breakpoints of other files untouched", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5), breakpoint("bp-2", "/b.ts", 3)];

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

    expect(shiftBreakpointsForEdit(list, "/a.ts", 5, -3)).toEqual([breakpoint("bp-1", "/a.ts", 5)]);
  });

  it("ignores other files and a zero delta", () => {
    const list = [breakpoint("bp-1", "/b.ts", 10)];

    expect(shiftBreakpointsForEdit(list, "/a.ts", 5, 3)).toEqual(list);
    expect(shiftBreakpointsForEdit(list, "/b.ts", 5, 0)).toEqual(list);
  });

  it("preserves breakpoint identity across shifts", () => {
    const list = [breakpoint("bp-1", "/a.ts", 5, { condition: "x > 1" })];

    const shifted = shiftBreakpointsForEdit(list, "/a.ts", 3, 4);

    expect(shifted).toEqual([breakpoint("bp-1", "/a.ts", 9, { condition: "x > 1" })]);
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
    expect(afterDelete).toEqual([breakpoint("bp-1", "/a.ts", 4), breakpoint("bp-3", "/a.ts", 5)]);
    expect(new Set(afterInsert.map((entry) => entry.lineNumber)).size).toBe(afterInsert.length);
    expect(new Set(afterDelete.map((entry) => entry.lineNumber)).size).toBe(afterDelete.length);
  });

  it("clamps shifted lines to line 1", () => {
    const list = [breakpoint("bp-1", "/a.ts", 1), breakpoint("bp-2", "/a.ts", 2)];

    expect(shiftBreakpointsForEdit(list, "/a.ts", 0, -2)).toEqual([breakpoint("bp-2", "/a.ts", 1)]);
  });
});

describe("serializeBreakpoints / deserializeBreakpoints", () => {
  it("round-trips ids, locations, composed conditions, log messages and enabled flags", () => {
    const list = [
      breakpoint("bp-1", "/a.ts", 5, {
        columnNumber: 7,
        condition: "x > 1",
        enabled: false,
        hitCondition: { kind: "multiple", count: 3 },
        logMessage: "value={x}",
      }),
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

  it("accepts exact positive legacy columns and rejects malformed presence", () => {
    const raw = JSON.stringify([
      { id: "line", filePath: "/a.ts", lineNumber: 1, enabled: true },
      { id: "one", filePath: "/a.ts", lineNumber: 1, columnNumber: 1, enabled: true },
      { id: "seven", filePath: "/a.ts", lineNumber: 1, columnNumber: 7, enabled: true },
      { id: "null", filePath: "/a.ts", lineNumber: 2, columnNumber: null, enabled: true },
      { id: "zero", filePath: "/a.ts", lineNumber: 3, columnNumber: 0, enabled: true },
      { id: "float", filePath: "/a.ts", lineNumber: 4, columnNumber: 1.5, enabled: true },
    ]);

    expect(deserializeBreakpoints(raw)).toEqual([
      breakpoint("line", "/a.ts", 1),
      breakpoint("one", "/a.ts", 1, { columnNumber: 1 }),
      breakpoint("seven", "/a.ts", 1, { columnNumber: 7 }),
    ]);
  });

  it("migrates duplicate exact locations first-valid while preserving presence siblings", () => {
    const raw = JSON.stringify([
      { id: "line-first", filePath: "/a.ts", lineNumber: 1, enabled: true },
      { id: "line-later", filePath: "/a.ts", lineNumber: 1, enabled: false },
      { id: "one-first", filePath: "/a.ts", lineNumber: 1, columnNumber: 1, enabled: true },
      { id: "one-later", filePath: "/a.ts", lineNumber: 1, columnNumber: 1, enabled: false },
      { id: "seven", filePath: "/a.ts", lineNumber: 1, columnNumber: 7, enabled: true },
    ]);

    expect(deserializeBreakpoints(raw)).toEqual([
      breakpoint("line-first", "/a.ts", 1),
      breakpoint("one-first", "/a.ts", 1, { columnNumber: 1 }),
      breakpoint("seven", "/a.ts", 1, { columnNumber: 7 }),
    ]);
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

    expect(deserializeBreakpoints(raw)).toEqual([breakpoint("bp-1", "/a.ts", 5)]);
  });

  it("migrates missing, null, and malformed hit conditions to none", () => {
    const raw = JSON.stringify([
      { id: "missing", filePath: "/a.ts", lineNumber: 1, enabled: true },
      { id: "null", filePath: "/a.ts", lineNumber: 2, enabled: true, hitCondition: null },
      {
        id: "invalid",
        filePath: "/a.ts",
        lineNumber: 3,
        enabled: true,
        hitCondition: { kind: "equals", count: 0 },
      },
      {
        id: "extra",
        filePath: "/a.ts",
        lineNumber: 4,
        enabled: true,
        hitCondition: { kind: "equals", count: 2, extra: true },
      },
    ]);

    expect(deserializeBreakpoints(raw)).toEqual([
      breakpoint("missing", "/a.ts", 1),
      breakpoint("null", "/a.ts", 2),
      breakpoint("invalid", "/a.ts", 3),
      breakpoint("extra", "/a.ts", 4),
    ]);
  });

  it("migrates missing, null, and malformed log messages to none", () => {
    const raw = JSON.stringify([
      { id: "missing", filePath: "/a.ts", lineNumber: 1, enabled: true },
      { id: "null", filePath: "/a.ts", lineNumber: 2, enabled: true, logMessage: null },
      { id: "invalid", filePath: "/a.ts", lineNumber: 3, enabled: true, logMessage: "x={" },
      { id: "valid", filePath: "/a.ts", lineNumber: 4, enabled: true, logMessage: "x={x}" },
    ]);

    expect(deserializeBreakpoints(raw)).toEqual([
      breakpoint("missing", "/a.ts", 1),
      breakpoint("null", "/a.ts", 2),
      breakpoint("invalid", "/a.ts", 3),
      breakpoint("valid", "/a.ts", 4, { logMessage: "x={x}" }),
    ]);
  });

  it("migrates duplicate and oversized persisted entries to a valid model", () => {
    const raw = JSON.stringify([
      { id: "same", filePath: "/a.ts", lineNumber: 1, enabled: true },
      { id: "same", filePath: "/b.ts", lineNumber: 2, enabled: true },
      { id: "é".repeat(65), filePath: "/c.ts", lineNumber: 3, enabled: true },
    ]);
    expect(deserializeBreakpoints(raw)).toEqual([breakpoint("same", "/a.ts", 1)]);
  });
});
