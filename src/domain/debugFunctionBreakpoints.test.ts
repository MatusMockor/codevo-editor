import { describe, expect, it } from "vitest";
import {
  addFunctionBreakpoint,
  deserializeFunctionBreakpoints,
  functionBreakpointNameError,
  isFunctionBreakpointName,
  removeFunctionBreakpoint,
  serializeFunctionBreakpoints,
  setFunctionBreakpointEnabled,
} from "./debugFunctionBreakpoints";

describe("debugFunctionBreakpoints", () => {
  it("accepts only bounded ASCII JavaScript identifier paths", () => {
    for (const name of ["render", "$start", "_private", "app.render", "a.b2.$call"]) {
      expect(isFunctionBreakpointName(name), name).toBe(true);
      expect(functionBreakpointNameError(name), name).toBeNull();
    }

    for (const name of [
      "",
      " render",
      "render ",
      "app..render",
      "app[render]",
      "app.render()",
      "app?.render",
      "app;process.exit()",
      "app\nrender",
      "app`render`",
      "1render",
      "éclair",
      "a.b.c.d.e.f.g.h.i",
      "a".repeat(257),
    ]) {
      expect(isFunctionBreakpointName(name), name).toBe(false);
      expect(functionBreakpointNameError(name), name).not.toBeNull();
    }
  });

  it("adds uniquely and removes or toggles by opaque id", () => {
    const added = addFunctionBreakpoint([], "app.render", () => "fn-1");
    expect(added).toEqual([{ id: "fn-1", functionName: "app.render", enabled: true }]);
    expect(addFunctionBreakpoint(added, "app.render", () => "fn-2")).toBe(added);
    expect(addFunctionBreakpoint(added, "app.save", () => "fn-1")).toBe(added);
    expect(addFunctionBreakpoint(added, "app.render()", () => "fn-2")).toBe(added);
    expect(setFunctionBreakpointEnabled(added, "fn-1", false)).toEqual([
      { id: "fn-1", functionName: "app.render", enabled: false },
    ]);
    expect(removeFunctionBreakpoint(added, "missing")).toBe(added);
    expect(removeFunctionBreakpoint(added, "fn-1")).toEqual([]);
  });

  it("round trips only closed valid unique persisted models", () => {
    const list = [
      { id: "fn-1", functionName: "render", enabled: true },
      { id: "fn-2", functionName: "app.save", enabled: false },
    ];
    expect(deserializeFunctionBreakpoints(serializeFunctionBreakpoints(list))).toEqual(list);
    expect(
      deserializeFunctionBreakpoints(
        JSON.stringify([
          ...list,
          { id: "fn-3", functionName: "process.exit()", enabled: true },
          { id: "fn-4", functionName: "render", enabled: true },
          { id: "fn-5", functionName: "safe", enabled: true, condition: "true" },
        ]),
      ),
    ).toEqual(list);
    expect(deserializeFunctionBreakpoints("not json")).toEqual([]);
  });
});
