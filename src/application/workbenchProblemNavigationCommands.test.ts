import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";
import { workbenchProblemNavigationCommands } from "./workbenchProblemNavigationCommands";

describe("workbenchProblemNavigationCommands", () => {
  it("returns problem navigation commands in registry order with metadata and shortcuts", () => {
    const shortcut = vi.fn(
      (commandId: KeymapCommandId) => `shortcut:${commandId}`,
    );
    const commands = createCommands({ shortcut });

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "editor.nextProblem",
        title: "Go to Next Problem",
        category: "Editor",
        shortcut: "shortcut:editor.nextProblem",
      },
      {
        id: "editor.previousProblem",
        title: "Go to Previous Problem",
        category: "Editor",
        shortcut: "shortcut:editor.previousProblem",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "editor.nextProblem");
    expect(shortcut).toHaveBeenNthCalledWith(2, "editor.previousProblem");
    expect(shortcut).toHaveBeenCalledTimes(2);
  });

  it("keeps both commands always available like their keyboard shortcuts", () => {
    expect(createCommands().map(enabled)).toEqual([true, true]);
  });

  it("propagates deferred next-problem completion as void", async () => {
    const navigation = createDeferred<boolean>();
    const goToNextProblem = vi.fn(() => navigation.promise);
    const [command] = createCommands({ goToNextProblem });

    const completion = command.run();

    expect(goToNextProblem).toHaveBeenCalledTimes(1);
    navigation.resolve(true);
    await expect(completion).resolves.toBeUndefined();
    expect(goToNextProblem).toHaveBeenCalledTimes(1);
  });

  it("propagates deferred previous-problem rejection", async () => {
    const navigation = createDeferred<boolean>();
    const failure = new Error("navigation failed");
    const goToPreviousProblem = vi.fn(() => navigation.promise);
    const [, command] = createCommands({ goToPreviousProblem });

    const completion = command.run();

    expect(goToPreviousProblem).toHaveBeenCalledTimes(1);
    navigation.reject(failure);
    await expect(completion).rejects.toBe(failure);
    expect(goToPreviousProblem).toHaveBeenCalledTimes(1);
  });

  it("converts a synchronous navigation throw to a rejection", async () => {
    const failure = new Error("synchronous navigation failure");
    const goToNextProblem = vi.fn(() => {
      throw failure;
    });
    const [command] = createCommands({ goToNextProblem });

    const completion = command.run();

    await expect(completion).rejects.toBe(failure);
    expect(goToNextProblem).toHaveBeenCalledTimes(1);
  });
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createCommands(
  overrides: Partial<Parameters<typeof workbenchProblemNavigationCommands>[0]> = {},
): Command[] {
  return workbenchProblemNavigationCommands({
    shortcut: (commandId) => commandId,
    goToNextProblem: vi.fn(),
    goToPreviousProblem: vi.fn(),
    ...overrides,
  });
}

function enabled(command: Command): boolean {
  return command.isEnabled({
    activeDocumentDirty: false,
    hasActiveDocument: false,
    hasWorkspace: false,
  });
}
