import { describe, expect, it } from "vitest";
import {
  MAX_VSCODE_PROCESS_TASK_OUTPUT_TOTAL_BYTES,
  reduceVscodeProcessTask,
  reduceVscodeProcessTaskProblems,
  vscodeProcessTaskProblemGroupKey,
  vscodeProcessTaskProblemsToNotices,
  type VscodeProcessTaskEvent,
  type VscodeProcessTaskOwner,
} from "./vscodeProcessTasks";

const owner: VscodeProcessTaskOwner = Object.freeze({
  runId: "run-1",
  workspaceId: "workspace-1",
  sessionId: 7,
  label: "Build",
  configRevision: "revision-1",
});

describe("reduceVscodeProcessTask", () => {
  it("owns one immutable task and accepts ordered exact-owner events", () => {
    const initial = reduceVscodeProcessTask(null, { type: "own", owner });
    const running = reduceVscodeProcessTask(initial, {
      type: "event",
      event: statusEvent(1, "running"),
    });
    const stepped = reduceVscodeProcessTask(running, {
      type: "event",
      event: stepEvent(2, "Compile", 1, 1),
    });
    const output = reduceVscodeProcessTask(stepped, {
      type: "event",
      event: outputEvent(3, "stdout", "built"),
    });
    const exited = reduceVscodeProcessTask(output, {
      type: "event",
      event: { kind: "status", owner, sequence: 4, status: "exited", exitCode: 0 },
    });

    expect(exited).toMatchObject({
      sequence: 4,
      status: "exited",
      exitCode: 0,
      currentStep: { label: "Compile", index: 1, total: 1 },
      output: [
        { kind: "step", label: "Compile", index: 1, total: 1 },
        { kind: "data", stream: "stdout", data: "built" },
      ],
    });
    expect(Object.isFrozen(exited)).toBe(true);
    expect(Object.isFrozen(exited?.output)).toBe(true);
    expect(Object.isFrozen(exited?.output[0])).toBe(true);
  });

  it("fails closed for foreign, stale, duplicate, and post-terminal events", () => {
    const initial = runningAtFirstStep();
    const accepted = reduceVscodeProcessTask(initial, {
      type: "event",
      event: outputEvent(3, "stdout", "accepted"),
    });
    const foreign = reduceVscodeProcessTask(accepted, {
      type: "event",
      event: {
        ...stepEvent(4, "Foreign", 2, 2),
        owner: { ...owner, configRevision: "other" },
      },
    });
    const stale = reduceVscodeProcessTask(foreign, {
      type: "event",
      event: stepEvent(3, "Duplicate", 2, 2),
    });
    const terminal = reduceVscodeProcessTask(stale, {
      type: "event",
      event: { kind: "status", owner, sequence: 4, status: "failed", message: "failed" },
    });
    const late = reduceVscodeProcessTask(terminal, {
      type: "event",
      event: stepEvent(5, "Late", 2, 2),
    });

    expect(foreign).toBe(accepted);
    expect(stale).toBe(accepted);
    expect(late).toBe(terminal);
    expect(late?.output).toHaveLength(2);
  });

  it("emits one truncation marker and ignores later output content", () => {
    const initial = runningAtFirstStep();
    const marker = reduceVscodeProcessTask(initial, {
      type: "event",
      event: { ...outputEvent(3, "stdout", ""), truncated: true },
    });
    const later = reduceVscodeProcessTask(marker, {
      type: "event",
      event: outputEvent(4, "stderr", "hidden"),
    });

    expect(later).toMatchObject({
      sequence: 4,
      output: [{ kind: "step", label: "Build", index: 1, total: 2 }, { kind: "truncated" }],
      outputBytes: 0,
      outputEventCount: 0,
      outputTruncated: true,
    });
  });

  it("uses the same single marker for the cumulative byte cap", () => {
    const initial = runningAtFirstStep();
    const full = reduceVscodeProcessTask(initial, {
      type: "event",
      event: outputEvent(3, "stdout", "x".repeat(MAX_VSCODE_PROCESS_TASK_OUTPUT_TOTAL_BYTES)),
    });
    const overflow = reduceVscodeProcessTask(full, {
      type: "event",
      event: outputEvent(4, "stdout", "x"),
    });
    const later = reduceVscodeProcessTask(overflow, {
      type: "event",
      event: outputEvent(5, "stdout", "x"),
    });

    expect(later?.output.filter(({ kind }) => kind === "truncated")).toHaveLength(1);
    expect(later?.sequence).toBe(5);
  });

  it("accepts exact contiguous steps only while running and keeps boundaries outside output caps", () => {
    const owned = reduceVscodeProcessTask(null, { type: "own", owner });
    const prematureOutput = reduceVscodeProcessTask(owned, {
      type: "event",
      event: outputEvent(1, "stdout", "hidden"),
    });
    const prematureStep = reduceVscodeProcessTask(prematureOutput, {
      type: "event",
      event: stepEvent(1, "Build", 1, 3),
    });
    const running = reduceVscodeProcessTask(prematureStep, {
      type: "event",
      event: statusEvent(1, "running"),
    });
    const skippedFirst = reduceVscodeProcessTask(running, {
      type: "event",
      event: stepEvent(2, "Test", 2, 3),
    });
    const first = reduceVscodeProcessTask(skippedFirst, {
      type: "event",
      event: stepEvent(2, "Build", 1, 3),
    });
    const repeated = reduceVscodeProcessTask(first, {
      type: "event",
      event: stepEvent(3, "Build again", 1, 3),
    });
    const changedTotal = reduceVscodeProcessTask(repeated, {
      type: "event",
      event: stepEvent(3, "Test", 2, 4),
    });
    const second = reduceVscodeProcessTask(changedTotal, {
      type: "event",
      event: stepEvent(3, "Test", 2, 3),
    });

    expect(prematureOutput).toBe(owned);
    expect(prematureStep).toBe(owned);
    expect(skippedFirst).toBe(running);
    expect(repeated).toBe(first);
    expect(changedTotal).toBe(first);
    expect(second).toMatchObject({
      sequence: 3,
      currentStep: { label: "Test", index: 2, total: 3 },
      outputBytes: 0,
      outputEventCount: 0,
      output: [
        { kind: "step", label: "Build", index: 1, total: 3 },
        { kind: "step", label: "Test", index: 2, total: 3 },
      ],
    });
    expect(Object.isFrozen(second?.currentStep)).toBe(true);
    expect(Object.isFrozen(second?.output[1])).toBe(true);
  });

  it("replaces an A-B-A owner by exact identity and clears explicitly", () => {
    const a = reduceVscodeProcessTask(null, { type: "own", owner });
    const b = reduceVscodeProcessTask(a, {
      type: "own",
      owner: { ...owner, sessionId: 8 },
    });
    const aAgain = reduceVscodeProcessTask(b, {
      type: "own",
      owner: { ...owner, runId: "run-2" },
    });

    expect(aAgain?.owner).toMatchObject({ runId: "run-2", sessionId: 7 });
    expect(aAgain?.sequence).toBe(0);
    expect(reduceVscodeProcessTask(aAgain, { type: "clear" })).toBeNull();
  });
});

describe("VS Code process task problems", () => {
  const problem = {
    filePath: "/workspace/src/index.ts",
    lineNumber: 3,
    column: 5,
    severity: "error",
    message: "No overload",
    code: "TS2769",
    source: "TypeScript",
  } as const;

  it("accepts only monotonic events from the full exact owner", () => {
    const initial = reduceVscodeProcessTaskProblems(null, { type: "own", owner })!;
    const appended = reduceVscodeProcessTaskProblems(initial, {
      type: "event",
      event: {
        kind: "problems",
        owner,
        sequence: 2,
        state: "append",
        problems: [problem],
        total: 1,
        truncated: false,
      },
    })!;

    expect(appended.problems).toEqual([problem]);
    expect(
      reduceVscodeProcessTaskProblems(appended, {
        type: "event",
        event: { kind: "problems", owner, sequence: 2, state: "clear" },
      }),
    ).toBe(appended);
    for (const foreignOwner of [
      { ...owner, runId: "run-2" },
      { ...owner, workspaceId: "workspace-2" },
      { ...owner, sessionId: 8 },
      { ...owner, label: "Test" },
      { ...owner, configRevision: "revision-2" },
    ]) {
      expect(
        reduceVscodeProcessTaskProblems(appended, {
          type: "event",
          event: {
            kind: "problems",
            owner: foreignOwner,
            sequence: 3,
            state: "clear",
          },
        }),
      ).toBe(appended);
    }
  });

  it("uses complete as an authoritative bounded snapshot", () => {
    const initial = reduceVscodeProcessTaskProblems(null, { type: "own", owner })!;
    const complete = reduceVscodeProcessTaskProblems(initial, {
      type: "event",
      event: {
        kind: "problems",
        owner,
        sequence: 9,
        state: "complete",
        problems: [problem],
        total: 1,
        truncated: false,
      },
    })!;

    expect(complete).toMatchObject({ sequence: 9, complete: true, problems: [problem] });
    expect(
      reduceVscodeProcessTaskProblems(complete, {
        type: "event",
        event: {
          kind: "problems",
          owner,
          sequence: 10,
          state: "append",
          problems: [problem],
          total: 2,
          truncated: false,
        },
      }),
    ).toMatchObject({ sequence: 10, complete: true, problems: [problem] });
  });

  it("projects only retained-root paths under a collision-resistant exact-owner group", () => {
    const state = {
      owner,
      sequence: 2,
      problems: [problem, { ...problem, filePath: "/outside/index.ts" }],
      total: 2,
      truncated: false,
      complete: true,
    } as const;

    const notices = vscodeProcessTaskProblemsToNotices(state, "/workspace");

    expect(vscodeProcessTaskProblemGroupKey(owner)).toContain(
      "node-package-task-problems:workspace-1:run-1:7:Build:revision-1",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      groupKey: vscodeProcessTaskProblemGroupKey(owner),
      source: "TypeScript",
      navigationTarget: { path: problem.filePath, range: { start: { lineNumber: 3, column: 5 } } },
    });
  });

  it("caps retained state and projected notices truthfully", () => {
    const initial = reduceVscodeProcessTaskProblems(null, { type: "own", owner })!;
    const problems = Array.from({ length: 257 }, (_, index) => ({
      ...problem,
      filePath: `/workspace/src/file-${index}.ts`,
    }));
    const complete = reduceVscodeProcessTaskProblems(initial, {
      type: "event",
      event: {
        kind: "problems",
        owner,
        sequence: 1,
        state: "complete",
        problems,
        total: problems.length,
        truncated: false,
      },
    })!;
    const notices = vscodeProcessTaskProblemsToNotices(complete, "/workspace");

    expect(complete.problems).toHaveLength(256);
    expect(complete.truncated).toBe(true);
    expect(notices).toHaveLength(101);
    expect(notices[notices.length - 1]).toMatchObject({ kind: "overflow", severity: "info" });
  });
});

function outputEvent(
  sequence: number,
  stream: "stdout" | "stderr",
  data: string,
): Extract<VscodeProcessTaskEvent, { kind: "output" }> {
  return { kind: "output", owner, sequence, stream, data, truncated: false };
}

function statusEvent(
  sequence: number,
  status: "running" | "stopped",
): Extract<VscodeProcessTaskEvent, { kind: "status"; status: "running" | "stopped" }> {
  return { kind: "status", owner, sequence, status };
}

function stepEvent(
  sequence: number,
  label: string,
  index: number,
  total: number,
): Extract<VscodeProcessTaskEvent, { kind: "step" }> {
  return { kind: "step", owner, sequence, label, index, total };
}

function runningAtFirstStep() {
  const owned = reduceVscodeProcessTask(null, { type: "own", owner });
  const running = reduceVscodeProcessTask(owned, {
    type: "event",
    event: statusEvent(1, "running"),
  });
  return reduceVscodeProcessTask(running, {
    type: "event",
    event: stepEvent(2, "Build", 1, 2),
  });
}
