import { describe, expect, it } from "vitest";
import {
  JS_TEST_PROBLEM_GROUP_PREFIX,
  MAX_JS_TEST_PROBLEM_NOTICES,
  jsTestProblemGroupKey,
  jsTestProblemSnapshotToNotices,
  type JsTestProblemEntry,
  type JsTestProblemsSnapshot,
} from "./jsTestProblems";

const owner = { rootKey: "/workspace", workspaceId: "workspace:id" } as const;

describe("JavaScript test problem notices", () => {
  it("projects sanitized snapshot content to exact workspace navigation targets", () => {
    const notices = jsTestProblemSnapshotToNotices(
      snapshot([
        problem({
          filePath: "src/math.test.ts",
          lineNumber: 7,
          message: "Expected 4, received 5",
          name: "math adds",
        }),
        problem({
          filePath: "src/setup.test.ts",
          lineNumber: 1,
          message: "Setup failed",
          name: null,
          status: "error",
        }),
      ]),
      "/workspace/",
    );

    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({
      groupKey: jsTestProblemGroupKey(owner),
      message: "math adds: Expected 4, received 5",
      navigationTarget: {
        path: "/workspace/src/math.test.ts",
        range: {
          end: { column: 1, lineNumber: 7 },
          start: { column: 1, lineNumber: 7 },
        },
      },
      severity: "error",
      source: "JavaScript Tests",
    });
    expect(notices[1]).toMatchObject({ message: "Setup failed", severity: "error" });
  });

  it("does not project a snapshot into another or unsafe workspace root", () => {
    const current = snapshot([problem()]);
    expect(jsTestProblemSnapshotToNotices(current, "/other")).toEqual([]);
    expect(jsTestProblemSnapshotToNotices(current, "../workspace")).toEqual([]);
  });

  it("renders at most 1,000 notices with one truthful overflow notice", () => {
    const entries = Array.from({ length: MAX_JS_TEST_PROBLEM_NOTICES + 1 }, (_, index) =>
      problem({ filePath: `src/case-${index}.test.ts`, name: `case ${index}` }),
    );
    const notices = jsTestProblemSnapshotToNotices(snapshot(entries), owner.rootKey);

    expect(notices).toHaveLength(MAX_JS_TEST_PROBLEM_NOTICES);
    expect(notices.filter(({ kind }) => kind === "overflow")).toHaveLength(1);
    expect(notices[notices.length - 1]).toMatchObject({
      groupKey: expect.stringMatching(`^${JS_TEST_PROBLEM_GROUP_PREFIX}`),
      kind: "overflow",
      message: "2 more JavaScript test problems hidden.",
      navigationTarget: undefined,
      severity: "info",
      source: "JavaScript Tests",
    });
  });

  it("uses a general overflow message when collection truncation makes the hidden count unknown", () => {
    const notices = jsTestProblemSnapshotToNotices(
      { ...snapshot([problem()]), truncated: true },
      owner.rootKey,
    );

    expect(notices[notices.length - 1]).toMatchObject({
      kind: "overflow",
      message: "JavaScript test problems were truncated. Additional problems may be hidden.",
    });
  });
});

function snapshot(entries: readonly JsTestProblemEntry[]): JsTestProblemsSnapshot {
  return { entries, generation: 1, owner, total: entries.length, truncated: false };
}

function problem(overrides: Partial<JsTestProblemEntry> = {}): JsTestProblemEntry {
  return {
    filePath: "src/example.test.ts",
    lineNumber: 3,
    message: "Test failed.",
    name: "example fails",
    status: "failed",
    ...overrides,
  };
}
