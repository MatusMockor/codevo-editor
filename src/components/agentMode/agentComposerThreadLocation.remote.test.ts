import { describe, expect, it } from "vitest";
import { projectRemoteAgentThreads } from "../../application/remoteAgentProjection";
import { agentLocationTokenText } from "../../domain/agentWorkspaceLocation";
import type { RemoteRunnerTask } from "../../domain/remoteRunner";
import { agentComposerThreadLocation } from "./agentComposerThreadLocation";

const root: RemoteRunnerTask = {
  id: "root",
  runnerId: "runner",
  sequence: 1,
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [{ type: "text", text: "First prompt" }],
  createdAt: "2026-09-13T00:00:00Z",
};

function remoteView(isolation: RemoteRunnerTask["isolation"]) {
  const views = projectRemoteAgentThreads({
    serverId: "server",
    runnerId: "runner",
    projects: [{ id: "project", name: "Project" }],
    tasks: [{ ...root, isolation }],
    replays: new Map(),
    resumes: new Map(),
  });
  expect(views).toHaveLength(1);
  return views[0]!;
}

describe("agentComposerThreadLocation for projected server threads", () => {
  it("names a started server worktree thread Worktree, never New worktree", () => {
    const location = agentComposerThreadLocation(
      remoteView("worktree"),
      [{ id: "server", name: "build-box" }],
      null,
    );
    expect(location?.checkout).toBe("worktree");
    expect(location?.path).toBeNull();
    expect(location === null ? null : agentLocationTokenText(location)).toBe(
      "build-box · Worktree",
    );
  });

  it("names a started server in-place thread Server checkout", () => {
    const location = agentComposerThreadLocation(
      remoteView("in-place"),
      [{ id: "server", name: "build-box" }],
      null,
    );
    expect(location === null ? null : agentLocationTokenText(location)).toBe(
      "build-box · Server checkout",
    );
  });
});
