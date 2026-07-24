import { describe, expect, it, vi } from "vitest";
import type { CommandExecutionRunner } from "./commandRegistry";
import { requestRegisteredCommand, runCommandChain, runRegisteredCommand } from "./commandChain";

describe("runCommandChain", () => {
  it("stops after the first executed candidate", () => {
    const runCommand = vi.fn<CommandExecutionRunner>((id) =>
      id === "second" ? "executed" : "disabled",
    );

    runCommandChain(runCommand, ["first", "second", "third"]);

    expect(runCommand.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
  });

  it("tries every candidate when all are unavailable", () => {
    const runCommand = vi.fn<CommandExecutionRunner>(() => "missing");

    runCommandChain(runCommand, ["first", "second"]);

    expect(runCommand.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
  });

  it("does nothing without a command runner", () => {
    expect(() => runCommandChain(undefined, ["first"])).not.toThrow();
  });

  it.each([undefined, "missing"] as const)(
    "uses a registered-command fallback for %s",
    (outcome) => {
      const fallback = vi.fn();
      const current = outcome === undefined ? undefined : vi.fn(() => outcome);

      runRegisteredCommand({ current }, "first", fallback);

      expect(fallback).toHaveBeenCalledOnce();
    },
  );

  it("requests a registered command only when a runner exists", () => {
    const current = vi.fn<CommandExecutionRunner>(() => "disabled");

    requestRegisteredCommand({ current }, "first");
    requestRegisteredCommand({ current: undefined }, "second");

    expect(current).toHaveBeenCalledOnce();
  });
});
