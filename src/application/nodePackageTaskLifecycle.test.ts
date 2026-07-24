import { describe, expect, it } from "vitest";
import { reduceNodePackageTaskState, type NodePackageTaskState } from "./nodePackageTaskLifecycle";

const stopping: NodePackageTaskState = {
  manifestRelativePath: "package.json",
  runId: "run-1",
  scriptName: "build",
  sessionId: 3,
  status: "stopping",
  workspaceId: "ws-1",
};

describe("node package task lifecycle", () => {
  it("never regresses a rejected stop back to running", () => {
    expect(reduceNodePackageTaskState(stopping, { type: "stop-rejected", runId: "run-1" })).toBe(
      stopping,
    );
  });

  it("makes stop acknowledgement terminal and ignores a later running event", () => {
    const stopped = reduceNodePackageTaskState(stopping, {
      type: "stop-accepted",
      runId: "run-1",
    });
    expect(stopped?.status).toBe("stopped");
    expect(
      reduceNodePackageTaskState(stopped, {
        type: "event",
        event: {
          manifestRelativePath: "package.json",
          runId: "run-1",
          scriptName: "build",
          sessionId: 3,
          status: "running",
          workspaceId: "ws-1",
        },
      }),
    ).toBe(stopped);
  });
});
