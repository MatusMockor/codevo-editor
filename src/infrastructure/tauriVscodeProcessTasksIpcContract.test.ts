import { describe, expect, it, vi } from "vitest";
import {
  ACKNOWLEDGE_VSCODE_PROCESS_TASK_START_IPC_COMMAND,
  decodeVscodeProcessTaskEvent,
  DISCOVER_VSCODE_PROCESS_TASKS_IPC_COMMAND,
  invokeAcknowledgeVscodeProcessTaskStartIpc,
  invokeDiscoverVscodeProcessTasksIpc,
  invokeStartVscodeProcessTaskIpc,
  invokeStopVscodeProcessTaskIpc,
  MAX_VSCODE_PROCESS_TASK_DEPENDENCIES,
  MAX_VSCODE_PROCESS_TASK_DEPENDENCY_EDGES,
  MAX_VSCODE_PROCESS_TASK_DIAGNOSTICS,
  MAX_VSCODE_PROCESS_TASK_EVENT_OUTPUT_BYTES,
  MAX_VSCODE_PROCESS_TASK_STEPS,
  MAX_VSCODE_PROCESS_TASKS,
  START_VSCODE_PROCESS_TASK_IPC_COMMAND,
  STOP_VSCODE_PROCESS_TASK_IPC_COMMAND,
  VSCODE_PROCESS_TASK_EVENT,
} from "./tauriVscodeProcessTasksIpcContract";

const CONFIG_REVISION = `sha256:${"a".repeat(64)}`;
const owner = {
  runId: "run-1",
  workspaceId: "workspace-1",
  sessionId: 9,
  label: "Build",
  configRevision: CONFIG_REVISION,
} as const;
const UNPAIRED_SURROGATE = String.fromCharCode(0xd800);

const snapshot = {
  configRevision: CONFIG_REVISION,
  tasks: [
    {
      label: "Build",
      detail: "Compile TypeScript",
      group: "build",
      source: ".vscode/tasks.json",
      executable: true,
      dependsOn: ["Generate"],
      problemMatcher: "typescript",
    },
    {
      label: "Unsupported shell",
      detail: null,
      group: "none",
      source: ".vscode/tasks.json",
      executable: false,
      dependsOn: [],
      problemMatcher: null,
    },
    {
      label: "Generate",
      detail: null,
      group: "none",
      source: ".vscode/tasks.json",
      executable: true,
      dependsOn: [],
      problemMatcher: "eslint",
    },
  ],
  diagnostics: [{ severity: "warning", message: "Shell tasks are not executable." }],
  truncated: false,
} as const;

describe("VS Code process tasks IPC contract", () => {
  it("keeps exact command/event names", () => {
    expect(MAX_VSCODE_PROCESS_TASKS).toBe(128);
    expect(MAX_VSCODE_PROCESS_TASK_DEPENDENCIES).toBe(32);
    expect(MAX_VSCODE_PROCESS_TASK_DEPENDENCY_EDGES).toBe(512);
    expect(MAX_VSCODE_PROCESS_TASK_EVENT_OUTPUT_BYTES).toBe(8_192);
    expect(MAX_VSCODE_PROCESS_TASK_STEPS).toBe(128);
    expect(DISCOVER_VSCODE_PROCESS_TASKS_IPC_COMMAND).toBe(
      "workspace_discover_vscode_process_tasks",
    );
    expect(START_VSCODE_PROCESS_TASK_IPC_COMMAND).toBe("workspace_start_vscode_process_task");
    expect(ACKNOWLEDGE_VSCODE_PROCESS_TASK_START_IPC_COMMAND).toBe(
      "workspace_acknowledge_vscode_process_task_start",
    );
    expect(STOP_VSCODE_PROCESS_TASK_IPC_COMMAND).toBe("workspace_stop_vscode_process_task");
    expect(VSCODE_PROCESS_TASK_EVENT).toBe("vscode-process-task://event");
  });

  it("discovers only deeply frozen bounded display metadata", async () => {
    const invoke = vi.fn(async () => snapshot);
    const result = await invokeDiscoverVscodeProcessTasksIpc(invoke, {
      workspaceId: "workspace-1",
    });

    expect(invoke).toHaveBeenCalledExactlyOnceWith("workspace_discover_vscode_process_tasks", {
      request: { workspaceId: "workspace-1" },
    });
    expect(result).toEqual(snapshot);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.tasks)).toBe(true);
    expect(Object.isFrozen(result.tasks[0])).toBe(true);
    expect(Object.isFrozen(result.tasks[0]?.dependsOn)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
    expect(result.tasks[0]).not.toHaveProperty("command");
    expect(result.tasks[0]).not.toHaveProperty("args");
    expect(result.tasks[0]).not.toHaveProperty("env");
  });

  it.each([
    { ...snapshot, drift: true },
    { ...snapshot, configRevision: "revision-1" },
    { ...snapshot, configRevision: "bad\nrevision" },
    { ...snapshot, tasks: "bad" },
    { ...snapshot, tasks: [...snapshot.tasks, { ...snapshot.tasks[0] }] },
    { ...snapshot, tasks: [{ ...snapshot.tasks[0], command: "tsc" }] },
    { ...snapshot, tasks: [{ ...snapshot.tasks[0], problemMatcher: "$tsc" }] },
    { ...snapshot, tasks: [{ ...snapshot.tasks[0], problemMatcher: "unknown" }] },
    { ...snapshot, tasks: [{ ...snapshot.tasks[0], problemMatcher: undefined }] },
    {
      ...snapshot,
      tasks: [{ ...snapshot.tasks[0], dependsOn: undefined }],
    },
    { ...snapshot, tasks: [{ ...snapshot.tasks[0], dependsOn: "Generate" }] },
    { ...snapshot, tasks: [{ ...snapshot.tasks[0], dependsOn: ["Generate", "Generate"] }] },
    {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          dependsOn: Array.from(
            { length: MAX_VSCODE_PROCESS_TASK_DEPENDENCIES + 1 },
            (_, index) => `dependency-${index}`,
          ),
        },
      ],
    },
    {
      ...snapshot,
      tasks: snapshot.tasks.filter(({ label }) => label !== "Generate"),
    },
    {
      ...snapshot,
      tasks: snapshot.tasks.map((task) =>
        task.label === "Generate" ? { ...task, dependsOn: ["Build"] } : task,
      ),
    },
    {
      ...snapshot,
      tasks: snapshot.tasks.map((task) =>
        task.label === "Generate" ? { ...task, executable: false } : task,
      ),
    },
    {
      ...snapshot,
      tasks: Array.from({ length: 17 }, (_, taskIndex) => ({
        ...snapshot.tasks[1],
        label: `display-only-${taskIndex}`,
        dependsOn: Array.from(
          { length: MAX_VSCODE_PROCESS_TASK_DEPENDENCIES },
          (_, dependencyIndex) => `dependency-${taskIndex}-${dependencyIndex}`,
        ),
      })),
    },
    { ...snapshot, tasks: [{ ...snapshot.tasks[0], label: UNPAIRED_SURROGATE }] },
    { ...snapshot, diagnostics: [{ severity: "info", message: "bad" }] },
    { ...snapshot, diagnostics: [{ severity: "warning", message: "bad\nmessage" }] },
    { ...snapshot, truncated: 0 },
  ])("rejects malformed or execution-bearing discovery responses", async (invalid) => {
    await expect(
      invokeDiscoverVscodeProcessTasksIpc(
        vi.fn(async () => invalid),
        { workspaceId: "workspace-1" },
      ),
    ).rejects.toThrow(TypeError);
  });

  it("enforces discovery count and encoded response caps", async () => {
    const task = snapshot.tasks[0];
    const tooManyTasks = Array.from({ length: MAX_VSCODE_PROCESS_TASKS + 1 }, (_, index) => ({
      ...task,
      label: `task-${index}`,
    }));
    await expect(
      invokeDiscoverVscodeProcessTasksIpc(
        vi.fn(async () => ({ ...snapshot, tasks: tooManyTasks })),
        { workspaceId: "workspace-1" },
      ),
    ).rejects.toThrow("at most");

    const tooManyDiagnostics = Array.from(
      { length: MAX_VSCODE_PROCESS_TASK_DIAGNOSTICS + 1 },
      () => snapshot.diagnostics[0],
    );
    await expect(
      invokeDiscoverVscodeProcessTasksIpc(
        vi.fn(async () => ({ ...snapshot, diagnostics: tooManyDiagnostics })),
        { workspaceId: "workspace-1" },
      ),
    ).rejects.toThrow("at most");

    const oversizedDiagnostics = Array.from(
      { length: MAX_VSCODE_PROCESS_TASK_DIAGNOSTICS },
      () => ({ severity: "warning", message: "x".repeat(4_096) }),
    );
    await expect(
      invokeDiscoverVscodeProcessTasksIpc(
        vi.fn(async () => ({ ...snapshot, diagnostics: oversizedDiagnostics })),
        { workspaceId: "workspace-1" },
      ),
    ).rejects.toThrow("encoded bytes");
  });

  it("starts with the exact server-authoritative selector and echoed owner", async () => {
    const invoke = vi.fn(async () => owner);
    await expect(invokeStartVscodeProcessTaskIpc(invoke, owner)).resolves.toEqual(owner);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("workspace_start_vscode_process_task", {
      request: owner,
    });

    await expect(
      invokeStartVscodeProcessTaskIpc(
        vi.fn(async () => ({ ...owner, configRevision: `sha256:${"b".repeat(64)}` })),
        owner,
      ),
    ).rejects.toThrow("exact requested task owner");
  });

  it.each([
    { ...owner, command: "tsc" },
    { ...owner, args: ["--build"] },
    { ...owner, env: { NODE_ENV: "production" } },
    { ...owner, runId: "" },
    { ...owner, workspaceId: "bad\u0000workspace" },
    { ...owner, sessionId: -1 },
    { ...owner, label: UNPAIRED_SURROGATE },
    { ...owner, configRevision: "revision\n1" },
  ])("rejects malformed or execution-bearing start requests before transport", async (invalid) => {
    const invoke = vi.fn(async () => owner);
    await expect(invokeStartVscodeProcessTaskIpc(invoke, invalid as never)).rejects.toThrow(
      TypeError,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("acknowledges and stops only with the exact full owner", async () => {
    const invoke = vi.fn(async () => null);
    await invokeAcknowledgeVscodeProcessTaskStartIpc(invoke, owner);
    await invokeStopVscodeProcessTaskIpc(invoke, owner);
    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_acknowledge_vscode_process_task_start", {
      request: owner,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_stop_vscode_process_task", {
      request: owner,
    });
    await expect(
      invokeStopVscodeProcessTaskIpc(
        vi.fn(async () => ({})),
        owner,
      ),
    ).rejects.toThrow("result");
  });

  it("decodes deeply frozen tagged output, step, and terminal status events", () => {
    const output = decodeVscodeProcessTaskEvent({
      kind: "output",
      owner,
      sequence: 1,
      stream: "stdout",
      data: "building\n",
      truncated: false,
    });
    const exited = decodeVscodeProcessTaskEvent({
      kind: "status",
      owner,
      sequence: 2,
      status: "exited",
      exitCode: 0,
    });
    const step = decodeVscodeProcessTaskEvent({
      kind: "step",
      owner,
      sequence: 2,
      label: "Build",
      index: 2,
      total: 3,
    });
    const failed = decodeVscodeProcessTaskEvent({
      kind: "status",
      owner,
      sequence: 3,
      status: "failed",
      message: "failed",
    });

    expect(output).toMatchObject({ kind: "output", sequence: 1, stream: "stdout" });
    expect(step).toEqual({ kind: "step", owner, sequence: 2, label: "Build", index: 2, total: 3 });
    expect(exited).toMatchObject({ kind: "status", status: "exited", exitCode: 0 });
    expect(failed).toMatchObject({ kind: "status", status: "failed", message: "failed" });
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.owner)).toBe(true);
    expect(Object.isFrozen(step)).toBe(true);
    expect(Object.isFrozen(step.owner)).toBe(true);
  });

  it("decodes strict bounded problems events", () => {
    const problem = {
      filePath: "/workspace/src/index.ts",
      lineNumber: 3,
      column: 5,
      severity: "error",
      message: "No overload",
      code: "TS2769",
      source: "TypeScript",
    };
    const reset = decodeVscodeProcessTaskEvent({
      kind: "problems",
      owner,
      sequence: 1,
      state: "reset",
    });
    const append = decodeVscodeProcessTaskEvent({
      kind: "problems",
      owner,
      sequence: 2,
      state: "append",
      problems: [problem],
      total: 1,
      truncated: false,
    });

    expect(reset).toEqual({ kind: "problems", owner, sequence: 1, state: "reset" });
    expect(append).toEqual({
      kind: "problems",
      owner,
      sequence: 2,
      state: "append",
      problems: [problem],
      total: 1,
      truncated: false,
    });
    expect(Object.isFrozen(append)).toBe(true);
    expect(Object.isFrozen("problems" in append ? append.problems : null)).toBe(true);
  });

  it.each([
    { kind: "problems", owner, sequence: 1, state: "unknown" },
    { kind: "problems", owner, sequence: 1, state: "reset", problems: [] },
    {
      kind: "problems",
      owner,
      sequence: 1,
      state: "append",
      problems: [
        {
          filePath: "/workspace/index.ts",
          lineNumber: 1,
          column: 1,
          severity: "error",
          message: "bad",
          code: null,
          source: "TypeScript",
        },
      ],
      total: 0,
      truncated: false,
    },
    {
      kind: "problems",
      owner,
      sequence: 1,
      state: "complete",
      problems: [
        {
          filePath: "relative.ts",
          lineNumber: 1,
          column: 1,
          severity: "error",
          message: "bad",
          code: null,
          source: "TypeScript",
        },
      ],
      total: 1,
      truncated: false,
    },
    {
      kind: "problems",
      owner,
      sequence: 1,
      state: "append",
      problems: Array.from({ length: 33 }, () => ({
        filePath: "/workspace/index.ts",
        lineNumber: 1,
        column: 1,
        severity: "error",
        message: "bad",
        code: null,
        source: "TypeScript",
      })),
      total: 33,
      truncated: false,
    },
    {
      kind: "problems",
      owner,
      sequence: 1,
      state: "complete",
      problems: [
        {
          filePath: "/workspace/index.ts",
          lineNumber: 1,
          column: 1,
          severity: "error",
          message: "x".repeat(2_049),
          code: null,
          source: "TypeScript",
        },
      ],
      total: 1,
      truncated: false,
    },
  ])("rejects malformed problems events", (event) => {
    expect(() => decodeVscodeProcessTaskEvent(event)).toThrow(TypeError);
  });

  it.each([
    { kind: "output", owner, sequence: 0, stream: "stdout", data: "x", truncated: false },
    { kind: "output", owner, sequence: 1, stream: "stdin", data: "x", truncated: false },
    { kind: "output", owner, sequence: 1, stream: "stdout", data: "\u0000", truncated: false },
    {
      kind: "output",
      owner,
      sequence: 1,
      stream: "stdout",
      data: "x".repeat(MAX_VSCODE_PROCESS_TASK_EVENT_OUTPUT_BYTES + 1),
      truncated: false,
    },
    { kind: "output", owner, sequence: 1, stream: "stdout", data: "x", truncated: true },
    {
      kind: "output",
      owner,
      sequence: 1,
      stream: "stdout",
      data: "",
      truncated: true,
      command: "hidden",
    },
    { kind: "step", owner, sequence: 1, label: "Build", index: 0, total: 1 },
    { kind: "step", owner, sequence: 1, label: "Build", index: 2, total: 1 },
    {
      kind: "step",
      owner,
      sequence: 1,
      label: "Build",
      index: 1,
      total: MAX_VSCODE_PROCESS_TASK_STEPS + 1,
    },
    { kind: "step", owner, sequence: 1, label: "bad\nlabel", index: 1, total: 1 },
    { kind: "step", owner, sequence: 1, label: "Build", index: 1, total: 1, command: "tsc" },
    { kind: "status", owner, sequence: 1, status: "exited" },
    { kind: "status", owner, sequence: 1, status: "stopped", exitCode: 0 },
    { kind: "status", owner, sequence: 1, status: "failed", message: "bad\nmessage" },
    { kind: "status", owner, sequence: 1, status: "unknown" },
  ])("rejects malformed, ambiguous, or execution-bearing events", (invalid) => {
    expect(() => decodeVscodeProcessTaskEvent(invalid)).toThrow(TypeError);
  });
});
