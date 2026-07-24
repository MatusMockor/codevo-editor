import { describe, expect, it } from "vitest";
import {
  MAX_NODE_PACKAGE_TASK_PROBLEM_CODE_BYTES,
  MAX_NODE_PACKAGE_TASK_PROBLEM_MESSAGE_BYTES,
  MAX_NODE_PACKAGE_TASK_PROBLEMS,
  MAX_NODE_PACKAGE_TASK_PROBLEMS_PER_EVENT,
  nodePackageProblemMatcherForScript,
  nodePackageTaskProblemGroupKey,
  nodePackageTaskProblemsToNotices,
  reduceNodePackageTaskOutput,
  reduceNodePackageTaskProblems,
  type NodePackageTaskProblem,
  type NodePackageTaskProblemsState,
} from "./nodePackageTaskProblems";

const owner = {
  runId: "run-1",
  workspaceId: "ws-1",
  sessionId: 7,
  manifestRelativePath: "package.json",
  scriptName: "lint",
};
const problem: NodePackageTaskProblem = {
  filePath: "/workspace/src/index.ts",
  lineNumber: 3,
  column: 5,
  severity: "error",
  message: "Unexpected any",
  code: "no-explicit-any",
  source: "ESLint",
};

describe("Node package task problems", () => {
  it("keeps the TypeScript decoder limits aligned with the Rust matcher", () => {
    expect(MAX_NODE_PACKAGE_TASK_PROBLEMS_PER_EVENT).toBe(32);
    expect(MAX_NODE_PACKAGE_TASK_PROBLEMS).toBe(256);
    expect(MAX_NODE_PACKAGE_TASK_PROBLEM_MESSAGE_BYTES).toBe(2_048);
    expect(MAX_NODE_PACKAGE_TASK_PROBLEM_CODE_BYTES).toBe(128);
  });

  it.each([
    ["lint", "eslint"],
    ["eslint", "eslint"],
    ["web:lint", "eslint"],
    ["typecheck", "typescript"],
    ["type-check", "typescript"],
    ["tsc", "typescript"],
    ["web:typecheck", "typescript"],
    ["lint:fix", null],
    ["prelint", null],
    ["check-types", null],
    ["Lint", null],
  ] as const)("selects only the intended matcher for %s", (name, expected) => {
    expect(nodePackageProblemMatcherForScript(name)).toBe(expected);
  });

  it("guards exact ownership and monotonically increasing sequences", () => {
    const initial = reduceNodePackageTaskProblems(null, { type: "own", owner })!;
    const appended = reduceNodePackageTaskProblems(initial, {
      type: "event",
      event: {
        kind: "append",
        owner,
        sequence: 2,
        problems: [problem],
        total: 1,
        truncated: false,
      },
    })!;
    expect(appended.problems).toEqual([problem]);
    expect(
      reduceNodePackageTaskProblems(appended, {
        type: "event",
        event: { kind: "clear", owner, sequence: 2 },
      }),
    ).toBe(appended);
    expect(
      reduceNodePackageTaskProblems(appended, {
        type: "event",
        event: { kind: "clear", owner: { ...owner, sessionId: 8 }, sequence: 3 },
      }),
    ).toBe(appended);
  });

  it("uses complete as an authoritative snapshot that heals a missing append", () => {
    const initial = reduceNodePackageTaskProblems(null, { type: "own", owner })!;
    const complete = reduceNodePackageTaskProblems(initial, {
      type: "event",
      event: {
        kind: "complete",
        owner,
        sequence: 9,
        problems: [problem],
        total: 1,
        truncated: false,
      },
    })!;
    expect(complete).toMatchObject({ sequence: 9, complete: true, problems: [problem] });
    expect(
      reduceNodePackageTaskProblems(complete, {
        type: "event",
        event: { kind: "append", owner, sequence: 8, problems: [], total: 0, truncated: false },
      }),
    ).toBe(complete);
  });

  it("defensively caps accumulated append events", () => {
    const initial: NodePackageTaskProblemsState = {
      owner,
      sequence: 1,
      problems: Array.from({ length: MAX_NODE_PACKAGE_TASK_PROBLEMS - 1 }, () => problem),
      total: MAX_NODE_PACKAGE_TASK_PROBLEMS - 1,
      truncated: false,
      complete: false,
    };
    const next = reduceNodePackageTaskProblems(initial, {
      type: "event",
      event: {
        kind: "append",
        owner,
        sequence: 2,
        problems: [problem, problem],
        total: MAX_NODE_PACKAGE_TASK_PROBLEMS + 1,
        truncated: false,
      },
    })!;
    expect(next.problems).toHaveLength(MAX_NODE_PACKAGE_TASK_PROBLEMS);
    expect(next.truncated).toBe(true);
  });

  it("maps safe retained-root paths to navigable problem notices", () => {
    const state: NodePackageTaskProblemsState = {
      owner,
      sequence: 2,
      problems: [problem, { ...problem, filePath: "/outside/file.ts" }],
      total: 2,
      truncated: false,
      complete: true,
    };
    const notices = nodePackageTaskProblemsToNotices(state, "/workspace");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      groupKey: nodePackageTaskProblemGroupKey(owner),
      source: "ESLint",
      navigationTarget: { path: problem.filePath, range: { start: { lineNumber: 3, column: 5 } } },
    });
  });

  it("accepts output monotonically and turns the first cap overflow into one marker", () => {
    let state = reduceNodePackageTaskOutput(null, { type: "own", owner })!;
    state = reduceNodePackageTaskOutput(state, {
      type: "event",
      event: { owner, sequence: 2, stream: "stdout", data: "ok", truncated: false },
    })!;
    const marker = reduceNodePackageTaskOutput(state, {
      type: "event",
      event: { owner, sequence: 3, stream: "stdout", data: "", truncated: true },
    })!;
    expect(marker.truncated).toBe(true);
    const ignored = reduceNodePackageTaskOutput(marker, {
      type: "event",
      event: { owner, sequence: 4, stream: "stderr", data: "later", truncated: false },
    })!;
    expect(ignored).toMatchObject({ sequence: 4, bytes: 2, eventCount: 1, truncated: true });
    expect(
      reduceNodePackageTaskOutput(ignored, {
        type: "event",
        event: { owner, sequence: 3, stream: "stdout", data: "stale", truncated: false },
      }),
    ).toBe(ignored);
  });
});
