import { describe, expect, it, vi } from "vitest";
import type { VscodeProcessTaskDisplay } from "../domain/vscodeProcessTasks";
import { workbenchVscodeProcessTaskCommands } from "./workbenchVscodeProcessTaskCommands";

const CONTEXT = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: true,
};

describe("workbenchVscodeProcessTaskCommands", () => {
  it("registers refresh and only executable labels that are globally unique", () => {
    const commands = createCommands({
      tasks: [
        task("Build", true),
        task("Shell", false),
        task("Duplicate", true),
        task("Duplicate", false),
      ],
    });

    expect(commands.map(({ id, title }) => ({ id, title }))).toEqual([
      {
        id: "tasks.vscode.refresh",
        title: "Tasks: Refresh Tasks",
      },
      {
        id: "tasks.vscode.run.Build",
        title: "Tasks: Run Task: Build",
      },
    ]);
  });

  it("uses stable collision-safe ids for arbitrary distinct labels", () => {
    const commands = createCommands({
      tasks: [task("a/b", true), task("a%2Fb", true), task("日本語 task", true)],
    });

    expect(commands.slice(1).map(({ id }) => id)).toEqual([
      "tasks.vscode.run.a%2Fb",
      "tasks.vscode.run.a%252Fb",
      "tasks.vscode.run.%E6%97%A5%E6%9C%AC%E8%AA%9E%20task",
    ]);
    expect(new Set(commands.map(({ id }) => id)).size).toBe(commands.length);
  });

  it.each([
    ["untrusted", { trusted: false }],
    ["unavailable", { available: false }],
    ["discovering", { discovering: true }],
    ["occupied", { occupied: true }],
  ])("disables refresh and run while %s", (_name, override) => {
    const commands = createCommands(override);

    expect(commands.every((command) => !command.isEnabled(CONTEXT))).toBe(true);
  });

  it("requires a workspace and enables every command only when fully available", () => {
    const commands = createCommands();

    expect(commands.every((command) => command.isEnabled(CONTEXT))).toBe(true);
    expect(
      commands.every((command) => command.isEnabled({ ...CONTEXT, hasWorkspace: false })),
    ).toBe(false);
  });

  it("awaits the exact refresh and label operations and propagates async errors", async () => {
    const refreshError = new Error("refresh failed");
    const startError = new Error("start failed");
    const discover = vi.fn(async () => {
      throw refreshError;
    });
    const start = vi.fn(async () => {
      throw startError;
    });
    const commands = createCommands({ discover, start, tasks: [task("Build", true)] });

    await expect(commands[0]!.run()).rejects.toBe(refreshError);
    await expect(commands[1]!.run()).rejects.toBe(startError);
    expect(discover).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledExactlyOnceWith("Build");
  });
});

function createCommands(
  override: Partial<Parameters<typeof workbenchVscodeProcessTaskCommands>[0]> = {},
) {
  return workbenchVscodeProcessTaskCommands({
    available: true,
    discover: vi.fn(async () => true),
    discovering: false,
    occupied: false,
    start: vi.fn(async () => true),
    tasks: [task("Build", true)],
    trusted: true,
    ...override,
  });
}

function task(label: string, executable: boolean): VscodeProcessTaskDisplay {
  return {
    detail: null,
    executable,
    group: "none",
    label,
    problemMatcher: null,
    source: ".vscode/tasks.json",
    dependsOn: [],
  };
}
