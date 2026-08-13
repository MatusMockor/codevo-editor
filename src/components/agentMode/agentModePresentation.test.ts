import { describe, expect, it } from "vitest";
import type { AgentTaskRecord } from "../../domain/agentTask";
import type { AgentTaskView, OrphanedWorktreeView } from "../../application/useAgentTasks";
import {
  MAX_AGENT_THREAD_TITLE_CHARACTERS,
  agentChangeStatusLetter,
  agentIsolationBadgeLabel,
  agentIsolationBadgeReason,
  agentRepositoryGroups,
  agentThreadStatusLabel,
  agentThreadTimeLabel,
  agentThreadTitle,
  agentThreadTone,
} from "./agentModePresentation";

const ROOT = "/workspace/app";
const NESTED = "/workspace/app/packages/api";

describe("agentModePresentation", () => {
  it("maps every task status to a tone and a label", () => {
    expect(agentThreadTone({ kind: "pending" })).toBe("queued");
    expect(agentThreadTone({ kind: "running" })).toBe("running");
    expect(agentThreadTone({ kind: "exited", exitCode: 0 })).toBe("done");
    expect(agentThreadTone({ kind: "exited", exitCode: 2 })).toBe("failed");
    expect(agentThreadTone({ kind: "failed", message: "boom" })).toBe("failed");
    expect(agentThreadTone({ kind: "stopped" })).toBe("stopped");

    expect(agentThreadStatusLabel({ kind: "pending" })).toBe("Queued");
    expect(agentThreadStatusLabel({ kind: "running" })).toBe("Running");
    expect(agentThreadStatusLabel({ kind: "exited", exitCode: 0 })).toBe("Finished");
    expect(agentThreadStatusLabel({ kind: "exited", exitCode: 2 })).toBe("Exited 2");
    expect(agentThreadStatusLabel({ kind: "failed", message: "boom" })).toBe("Failed");
    expect(agentThreadStatusLabel({ kind: "stopped" })).toBe("Stopped");
  });

  it("titles a thread from the first prompt line and bounds its length", () => {
    expect(agentThreadTitle("Add a skeleton state\nand keep the grid mounted")).toBe(
      "Add a skeleton state",
    );
    expect(agentThreadTitle("   ")).toBe("Untitled thread");

    const long = "x".repeat(MAX_AGENT_THREAD_TITLE_CHARACTERS + 40);
    const title = agentThreadTitle(long);

    expect(title).toHaveLength(MAX_AGENT_THREAD_TITLE_CHARACTERS + 1);
    expect(title.endsWith("…")).toBe(true);
  });

  it("skips leading blank prompt lines instead of falling back to the whole prompt", () => {
    expect(agentThreadTitle("\n\n  Rename the port\nand update the adapter")).toBe(
      "Rename the port",
    );
  });

  it("never splits a surrogate pair at the title boundary", () => {
    const prompt = `${"x".repeat(MAX_AGENT_THREAD_TITLE_CHARACTERS - 1)}🚀 tail`;
    const title = agentThreadTitle(prompt);

    expect(Array.from(title)).toHaveLength(MAX_AGENT_THREAD_TITLE_CHARACTERS + 1);
    expect(title.endsWith("🚀…")).toBe(true);
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(title),
    ).toBe(false);
  });

  it("renders a relative start time", () => {
    const now = 1_700_000_000_000;

    expect(agentThreadTimeLabel(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(agentThreadTimeLabel(now, now)).toBe("just now");
  });

  it("describes both isolation modes truthfully", () => {
    expect(agentIsolationBadgeLabel("worktree")).toBe("Worktree");
    expect(agentIsolationBadgeLabel("in-place")).toBe("In place");
    expect(agentIsolationBadgeReason("worktree")).toContain("dedicated Git worktree");
    expect(agentIsolationBadgeReason("in-place")).toContain("directly in your checkout");
  });

  it("maps every Git change status to a letter", () => {
    expect(agentChangeStatusLetter("added")).toBe("A");
    expect(agentChangeStatusLetter("conflicted")).toBe("C");
    expect(agentChangeStatusLetter("deleted")).toBe("D");
    expect(agentChangeStatusLetter("modified")).toBe("M");
    expect(agentChangeStatusLetter("renamed")).toBe("R");
    expect(agentChangeStatusLetter("untracked")).toBe("U");
  });

  it("groups threads and orphans under their resolved repository", () => {
    const groups = agentRepositoryGroups(
      [
        { mapping: { rootRelativePath: "" }, repositoryRoot: ROOT, repositoryRelativePath: "" },
        {
          mapping: { rootRelativePath: "packages/api" },
          repositoryRoot: NESTED,
          repositoryRelativePath: "",
        },
      ],
      [threadView("agt-1", ROOT, { kind: "running" }), threadView("agt-2", NESTED)],
      [orphan(NESTED, `${NESTED}/.worktrees/agt-9`)],
      ROOT,
    );

    expect(groups.map((group) => group.label)).toEqual(["app", "packages/api"]);
    expect(groups[0]?.threads.map((thread) => thread.record.owner.taskId)).toEqual(["agt-1"]);
    expect(groups[0]?.repositoryResolved).toBe(true);
    expect(groups[0]?.liveCount).toBe(1);
    expect(groups[1]?.orphans).toHaveLength(1);
    expect(groups[1]?.liveCount).toBe(0);
  });

  it("keeps threads of an unresolved repository visible in a detached group", () => {
    const groups = agentRepositoryGroups(
      [{ mapping: { rootRelativePath: "" }, repositoryRoot: ROOT, repositoryRelativePath: "" }],
      [threadView("agt-3", "/elsewhere/repo")],
      [],
      ROOT,
    );

    expect(groups.map((group) => group.repositoryRoot)).toEqual([ROOT, "/elsewhere/repo"]);
    expect(groups[1]?.threads).toHaveLength(1);
    expect(groups[1]?.repositoryResolved).toBe(false);
  });
});

function threadView(
  taskId: string,
  repositoryRoot: string,
  status: AgentTaskRecord["status"] = { kind: "exited", exitCode: 0 },
): AgentTaskView {
  return {
    record: {
      owner: { taskId, workspaceId: "workspace-a", repositoryRoot },
      isolation: "worktree",
      worktreePath: `${repositoryRoot}/.worktrees/${taskId}`,
      prompt: `Prompt for ${taskId}`,
      status,
      outputTail: "",
      outputTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      startedAtEpochMs: 1_700_000_000_000,
    },
    repositoryLabel: repositoryRoot,
    terminal: status.kind !== "running" && status.kind !== "pending",
    worktreeRemoved: false,
    changeSummary: null,
  };
}

function orphan(repositoryRoot: string, worktreePath: string): OrphanedWorktreeView {
  return {
    repositoryRoot,
    worktreePath,
    branch: "agent/agt-9",
    prunable: false,
    removing: false,
  };
}
