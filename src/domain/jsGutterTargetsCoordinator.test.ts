import { describe, expect, it } from "vitest";
import { JsGutterTargetsCoordinator } from "./jsGutterTargetsCoordinator";

const SOURCE = `describe("sum", () => {
  it("adds numbers", () => {});
});
`;

describe("JsGutterTargetsCoordinator", () => {
  it("resolves test targets for a JS test file", () => {
    const coordinator = new JsGutterTargetsCoordinator();

    const targets = coordinator.resolveTest(
      "/workspace",
      "/workspace/src/sum.test.ts",
      SOURCE,
    );

    expect(targets.map(({ filter, kind }) => ({ filter, kind }))).toEqual([
      { filter: "sum", kind: "class" },
      { filter: "adds numbers", kind: "method" },
    ]);
  });

  it("returns the cached parse for identical content", () => {
    const coordinator = new JsGutterTargetsCoordinator();

    const first = coordinator.resolveTest(
      "/workspace",
      "/workspace/src/sum.test.ts",
      SOURCE,
    );
    const second = coordinator.resolveTest(
      "/workspace",
      "/workspace/src/sum.test.ts",
      SOURCE,
    );

    expect(second).toBe(first);
  });

  it("keeps parses isolated between workspace roots for the same relative path", () => {
    const coordinator = new JsGutterTargetsCoordinator();

    const first = coordinator.resolveTest(
      "/workspace-a",
      "/workspace-a/src/sum.test.ts",
      SOURCE,
    );
    const other = coordinator.resolveTest(
      "/workspace-b",
      "/workspace-b/src/sum.test.ts",
      `it("only one", () => {});\n`,
    );

    expect(first.map(({ filter }) => filter)).toEqual(["sum", "adds numbers"]);
    expect(other.map(({ filter }) => filter)).toEqual(["only one"]);
  });

  it("re-parses when content changes", () => {
    const coordinator = new JsGutterTargetsCoordinator();
    coordinator.resolveTest("/workspace", "/workspace/src/sum.test.ts", SOURCE);

    const edited = coordinator.resolveTest(
      "/workspace",
      "/workspace/src/sum.test.ts",
      `it("renamed", () => {});\n`,
    );

    expect(edited.map(({ filter }) => filter)).toEqual(["renamed"]);
  });
});
