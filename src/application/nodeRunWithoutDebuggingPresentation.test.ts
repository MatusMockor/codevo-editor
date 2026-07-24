import { describe, expect, it } from "vitest";
import type { NodeRunTarget } from "../domain/nodeRunTask";
import type { NodeRunWithoutDebuggingState } from "./useNodeRunWithoutDebugging";
import { presentNodeRunWithoutDebugging } from "./nodeRunWithoutDebuggingPresentation";

const secretTarget: NodeRunTarget = {
  args: ["--token=secret-argument"],
  env: { API_TOKEN: "secret-environment" },
  kind: "node-configured-script",
  scriptPath: "/workspace/secret-script.ts",
};

describe("presentNodeRunWithoutDebugging", () => {
  it.each([
    [{ kind: "idle" }, null],
    [{ kind: "resolving" }, "Node: Resolving"],
    [{ kind: "waiting-for-terminal", target: secretTarget }, "Node: Waiting for terminal"],
    [activeState("starting"), "Node: Starting"],
    [activeState("running"), "Node: Running"],
    [stoppingState(false), "Node: Stopping"],
    [stoppingState(true), "Node: Stop failed"],
    [{ kind: "exited", exitCode: 0 }, null],
    [{ kind: "failed", message: "secret failure" }, null],
  ] satisfies ReadonlyArray<readonly [NodeRunWithoutDebuggingState, string | null]>)(
    "maps $0 to its safe lifecycle presentation",
    (state, expectedLabel) => {
      expect(presentNodeRunWithoutDebugging(state)?.label ?? null).toBe(expectedLabel);
    },
  );

  it("projects an active run without leaking its owner, target, arguments, or environment", () => {
    const presentation = presentNodeRunWithoutDebugging(activeState("running"));
    const serialized = JSON.stringify(presentation);

    expect(presentation).toEqual({
      canStop: true,
      label: "Node: Running",
      phase: "running",
      stopLabel: "Stop Node run — Running",
    });
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("workspace-owner");
    expect(serialized).not.toContain("run-owner");
  });

  it("only enables a stopping run after a failed stop becomes retryable", () => {
    expect(presentNodeRunWithoutDebugging(stoppingState(false))?.canStop).toBe(false);
    expect(presentNodeRunWithoutDebugging(stoppingState(true))?.canStop).toBe(true);
  });
});

function activeState(
  kind: "starting" | "running",
): Extract<NodeRunWithoutDebuggingState, { kind: "starting" | "running" }> {
  return {
    kind,
    runId: "run-owner",
    target: secretTarget,
    terminalSessionId: 7,
    workspaceId: "workspace-owner",
  };
}

function stoppingState(
  retryable: boolean,
): Extract<NodeRunWithoutDebuggingState, { kind: "stopping" }> {
  return {
    ...activeState("running"),
    kind: "stopping",
    retryable,
  };
}
