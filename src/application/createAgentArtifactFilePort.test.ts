import { describe, expect, it, vi } from "vitest";
import type {
  AgentArtifactFileLocation,
  AgentArtifactFileLocator,
  AgentArtifactOwner,
  AgentArtifactWorkspaceAuthority,
} from "./agentArtifactPorts";
import {
  agentArtifactActionNotice,
  agentArtifactFileActionsBlockedReason,
  createAgentArtifactFilePort,
  AGENT_ARTIFACT_FOREIGN_WORKSPACE,
  AGENT_ARTIFACT_OPEN_FAILED,
  AGENT_ARTIFACT_REMOTE_FILE_REASON,
} from "./createAgentArtifactFilePort";

const ROOT = "/workspace/app";
const local: AgentArtifactOwner = {
  kind: "local",
  rootKey: ROOT,
  ownerId: "owner",
  repositoryRoot: ROOT,
  threadId: "agt-1-0a1b",
  turnId: "agt-2-0a1b",
};
const remote: AgentArtifactOwner = {
  kind: "remote",
  serverId: "server",
  runnerId: "runner",
  taskId: "task",
};
const location: AgentArtifactFileLocation = { filePath: `${ROOT}/docs/design/page.html` };

function locator(resolved: AgentArtifactFileLocation = location): AgentArtifactFileLocator {
  return {
    locate: vi.fn().mockResolvedValue(resolved),
    reveal: vi.fn().mockResolvedValue(undefined),
  };
}

function surface() {
  return { openFile: vi.fn().mockResolvedValue(undefined) };
}

function workspace(roots: Array<string | null>): AgentArtifactWorkspaceAuthority {
  return {
    activeWorkspaceRoot: () => (roots.length > 1 ? (roots.shift() ?? null) : (roots[0] ?? null)),
  };
}

describe("createAgentArtifactFilePort", () => {
  it("opens the located file and keeps the captured workspace authority at commit time", async () => {
    const files = locator();
    const view = surface();
    const active = { root: ROOT as string | null };
    const port = createAgentArtifactFilePort(files, view, {
      activeWorkspaceRoot: () => active.root,
    });

    await port.openInEditor(local, "docs/design/page.html");

    expect(files.locate).toHaveBeenCalledWith(local, "docs/design/page.html");
    expect(view.openFile).toHaveBeenCalledTimes(1);
    const [opened, shouldCommit] = view.openFile.mock.calls[0]!;
    expect(opened).toEqual(location);
    expect(shouldCommit()).toBe(true);
    active.root = "/workspace/other";
    expect(shouldCommit()).toBe(false);
  });

  it("refuses to open a file into a workspace that replaced the captured one", async () => {
    const files = locator();
    const view = surface();
    const port = createAgentArtifactFilePort(files, view, workspace([ROOT, "/workspace/other"]));

    await expect(port.openInEditor(local, "docs/design/page.html")).rejects.toThrow(
      AGENT_ARTIFACT_FOREIGN_WORKSPACE,
    );
    expect(view.openFile).not.toHaveBeenCalled();
  });

  it("refuses a located path outside the thread's own repository root", async () => {
    const files = locator({ filePath: "/workspace/app-other/docs/page.html" });
    const view = surface();
    const port = createAgentArtifactFilePort(files, view, {
      activeWorkspaceRoot: () => "/workspace",
    });

    await expect(port.openInEditor(local, "docs/page.html")).rejects.toThrow(
      AGENT_ARTIFACT_FOREIGN_WORKSPACE,
    );
    expect(view.openFile).not.toHaveBeenCalled();
  });

  it("refuses a located path outside the active workspace root", async () => {
    const files = locator();
    const view = surface();
    const port = createAgentArtifactFilePort(files, view, {
      activeWorkspaceRoot: () => "/workspace/app/packages/ui",
    });

    await expect(port.openInEditor(local, "docs/design/page.html")).rejects.toThrow(
      AGENT_ARTIFACT_FOREIGN_WORKSPACE,
    );
    expect(view.openFile).not.toHaveBeenCalled();
  });

  it("opens a worktree file that lives under the thread's repository root", async () => {
    const worktree = `${ROOT}/.codevo-worktrees/agt-1/docs/page.html`;
    const files = locator({ filePath: worktree });
    const view = surface();
    const port = createAgentArtifactFilePort(files, view, { activeWorkspaceRoot: () => ROOT });

    await port.openInEditor(local, "docs/page.html");

    expect(view.openFile.mock.calls[0]?.[0]).toEqual({ filePath: worktree });
  });

  it("refuses while the active workspace identity is still pending", async () => {
    const files = locator();
    const view = surface();
    const port = createAgentArtifactFilePort(files, view, { activeWorkspaceRoot: () => null });

    await expect(port.openInEditor(local, "docs/design/page.html")).rejects.toThrow(
      AGENT_ARTIFACT_FOREIGN_WORKSPACE,
    );
    expect(files.locate).not.toHaveBeenCalled();
  });

  it("reveals through the native locator without computing a root path", async () => {
    const files = locator();
    const view = surface();
    const port = createAgentArtifactFilePort(files, view, { activeWorkspaceRoot: () => ROOT });

    await port.revealInFileManager(local, "docs/design/page.html");

    expect(files.reveal).toHaveBeenCalledWith(local, "docs/design/page.html");
    expect(files.locate).not.toHaveBeenCalled();
  });

  it("refuses remote owners before touching the locator", async () => {
    const files = locator();
    const view = surface();
    const port = createAgentArtifactFilePort(files, view, { activeWorkspaceRoot: () => ROOT });

    await expect(port.openInEditor(remote, "page.html")).rejects.toThrow(
      AGENT_ARTIFACT_REMOTE_FILE_REASON,
    );
    await expect(port.revealInFileManager(remote, "page.html")).rejects.toThrow(
      AGENT_ARTIFACT_REMOTE_FILE_REASON,
    );
    expect(files.locate).not.toHaveBeenCalled();
    expect(files.reveal).not.toHaveBeenCalled();
    expect(view.openFile).not.toHaveBeenCalled();
  });

  it("propagates a refused location instead of opening anything", async () => {
    const files: AgentArtifactFileLocator = {
      locate: vi.fn().mockRejectedValue(new Error("Artifact is outside its workspace.")),
      reveal: vi.fn(),
    };
    const view = surface();
    const port = createAgentArtifactFilePort(files, view, { activeWorkspaceRoot: () => ROOT });

    await expect(port.openInEditor(local, "../escape.html")).rejects.toThrow(
      "Artifact is outside its workspace.",
    );
    expect(view.openFile).not.toHaveBeenCalled();
  });

  it("names the blocked reason for remote owners only", () => {
    expect(agentArtifactFileActionsBlockedReason(remote)).toBe(AGENT_ARTIFACT_REMOTE_FILE_REASON);
    expect(agentArtifactFileActionsBlockedReason(local)).toBeNull();
  });

  it("keeps only the known bounded refusals as their own notice", () => {
    expect(
      agentArtifactActionNotice(
        new Error(AGENT_ARTIFACT_FOREIGN_WORKSPACE),
        AGENT_ARTIFACT_OPEN_FAILED,
      ),
    ).toBe(AGENT_ARTIFACT_FOREIGN_WORKSPACE);
    expect(
      agentArtifactActionNotice(
        new Error(AGENT_ARTIFACT_REMOTE_FILE_REASON),
        AGENT_ARTIFACT_OPEN_FAILED,
      ),
    ).toBe(AGENT_ARTIFACT_REMOTE_FILE_REASON);
    expect(agentArtifactActionNotice(new Error("boom"), AGENT_ARTIFACT_OPEN_FAILED)).toBe(
      AGENT_ARTIFACT_OPEN_FAILED,
    );
    expect(agentArtifactActionNotice("boom", AGENT_ARTIFACT_OPEN_FAILED)).toBe(
      AGENT_ARTIFACT_OPEN_FAILED,
    );
  });
});
