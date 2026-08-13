import { describe, expect, it } from "vitest";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentTaskRecord } from "../../domain/agentTask";
import type { ResolvedGitRepository } from "../../domain/gitRepositoryMapping";
import type { AgentTaskView, OrphanedWorktreeView } from "../../application/useAgentTasks";
import {
  DETACHED_AGENT_PROJECT_LABEL,
  DETACHED_AGENT_PROJECT_ROOT_KEY,
  MAX_AGENT_THREAD_TITLE_CHARACTERS,
  agentChangeStatusLetter,
  agentIsolationBadgeLabel,
  agentIsolationBadgeReason,
  agentProjectGroups,
  agentProjectOriginBadge,
  agentProjectTrustNotice,
  agentProjectWorktreeOnly,
  agentProjectWorktreeOnlyReason,
  agentThreadStatusLabel,
  agentThreadTimeLabel,
  agentThreadTitle,
  agentThreadTone,
} from "./agentModePresentation";

const ROOT = "/workspace/app";
const NESTED = "/workspace/app/packages/api";
const OTHER_ROOT = "/workspace/api-service";

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

  it("describes trust, origin and the worktree-only rule of a project", () => {
    expect(agentProjectTrustNotice("trusted")).toBeNull();
    expect(agentProjectTrustNotice("untrusted")).toContain("not trusted");
    expect(agentProjectTrustNotice("unknown")).toContain("could not be read");

    expect(agentProjectOriginBadge("active-tab")).toBeNull();
    expect(agentProjectOriginBadge("background-tab")).toBe("Background");
    expect(agentProjectOriginBadge("closed-tab-live-tasks")).toBe("Tab closed");

    expect(agentProjectWorktreeOnly("active-tab")).toBe(false);
    expect(agentProjectWorktreeOnly("background-tab")).toBe(true);
    expect(agentProjectWorktreeOnly("closed-tab-live-tasks")).toBe(true);

    expect(agentProjectWorktreeOnlyReason("active-tab")).toBeNull();
    expect(agentProjectWorktreeOnlyReason("background-tab")).toContain("isolated worktree");
    expect(agentProjectWorktreeOnlyReason("closed-tab-live-tasks")).toContain("tab is closed");
  });

  it("collapses a single-repository project into one flat thread list", () => {
    const groups = agentProjectGroups(
      [project({ repositories: [repository("", ROOT)] })],
      [threadView("agt-1", ROOT, { kind: "running" }), threadView("agt-2", ROOT)],
      [orphan(ROOT, `${ROOT}/.worktrees/agt-9`)],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("project");
    expect(groups[0]?.label).toBe("app");
    expect(groups[0]?.singleRepo).toBe(true);
    expect(groups[0]?.repos).toHaveLength(1);
    expect(groups[0]?.repos[0]?.threads.map((thread) => thread.record.owner.taskId)).toEqual([
      "agt-1",
      "agt-2",
    ]);
    expect(groups[0]?.repos[0]?.orphans).toHaveLength(1);
    expect(groups[0]?.liveCount).toBe(1);
  });

  it("keeps a multi-repository project nested and rolls its live threads up", () => {
    const groups = agentProjectGroups(
      [
        project({
          label: "monorepo",
          repositories: [repository("", ROOT), repository("packages/api", NESTED)],
        }),
      ],
      [
        threadView("agt-1", ROOT, { kind: "running" }),
        threadView("agt-2", NESTED, { kind: "running" }),
      ],
      [],
    );

    expect(groups[0]?.singleRepo).toBe(false);
    expect(groups[0]?.repos.map((repo) => repo.label)).toEqual(["app", "packages/api"]);
    expect(groups[0]?.liveCount).toBe(2);
  });

  it("gives an aliased repository to the first project in tab order only", () => {
    const groups = agentProjectGroups(
      [
        project({ repositories: [repository("", ROOT), repository("packages/api", NESTED)] }),
        project({
          rootKey: OTHER_ROOT,
          rootPath: OTHER_ROOT,
          label: "api-service",
          origin: "background-tab",
          repositories: [repository("", NESTED)],
        }),
      ],
      [threadView("agt-1", NESTED)],
      [],
    );

    expect(groups.map((group) => group.label)).toEqual(["app", "api-service"]);
    expect(groups[0]?.repos.map((repo) => repo.repositoryRoot)).toEqual([ROOT, NESTED]);
    expect(groups[1]?.repos).toHaveLength(0);
    expect(groups[1]?.singleRepo).toBe(false);
    expect(groups[0]?.repos[1]?.threads).toHaveLength(1);
  });

  it("keeps a thread under its owning project after the active tab reclaims the shared repository", () => {
    const monorepoOwner = `agent-root:${ROOT}`;
    const groups = agentProjectGroups(
      [
        project({
          rootKey: OTHER_ROOT,
          rootPath: OTHER_ROOT,
          label: "api-service",
          repositories: [repository("", NESTED)],
        }),
        project({
          label: "monorepo",
          origin: "background-tab",
          repositories: [repository("", ROOT)],
        }),
      ],
      [threadView("agt-1", NESTED, { kind: "running" }, monorepoOwner)],
      [],
    );

    const apiService = groups[0];
    const monorepo = groups[1];
    expect(apiService?.repos[0]?.repositoryRoot).toBe(NESTED);
    expect(apiService?.repos[0]?.threads).toHaveLength(0);
    expect(apiService?.liveCount).toBe(0);
    expect(monorepo?.singleRepo).toBe(false);
    expect(monorepo?.repos.map((repo) => repo.repositoryRoot)).toEqual([ROOT, NESTED]);
    expect(monorepo?.repos[1]?.repositoryResolved).toBe(false);
    expect(monorepo?.repos[1]?.label).toBe("packages/api");
    expect(monorepo?.repos[1]?.threads.map((thread) => thread.record.owner.taskId)).toEqual([
      "agt-1",
    ]);
    expect(monorepo?.liveCount).toBe(1);
    expect(groups).toHaveLength(2);
  });

  it("ignores a duplicate descriptor for the same project root", () => {
    const groups = agentProjectGroups(
      [
        project({ repositories: [repository("", ROOT)] }),
        project({ origin: "background-tab", repositories: [repository("", ROOT)] }),
      ],
      [],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.origin).toBe("active-tab");
  });

  it("keeps threads of a vanished project in a trailing detached group", () => {
    const groups = agentProjectGroups(
      [project({ repositories: [repository("", ROOT)] })],
      [
        threadView("agt-1", ROOT),
        threadView("agt-3", "/elsewhere/repo", undefined, "workspace-vanished"),
      ],
      [orphan("/elsewhere/repo", "/elsewhere/repo/.worktrees/agt-8")],
    );

    expect(groups.map((group) => group.projectRootKey)).toEqual([
      ROOT,
      DETACHED_AGENT_PROJECT_ROOT_KEY,
    ]);
    expect(groups[1]?.kind).toBe("detached");
    expect(groups[1]?.label).toBe(DETACHED_AGENT_PROJECT_LABEL);
    expect(groups[1]?.singleRepo).toBe(false);
    expect(groups[1]?.repos[0]?.repositoryResolved).toBe(false);
    expect(groups[1]?.repos[0]?.threads).toHaveLength(1);
    expect(groups[1]?.repos[0]?.orphans).toHaveLength(1);
  });

  it("floats pinned threads to the top within their own repository group", () => {
    const groups = agentProjectGroups(
      [
        project({
          repositories: [repository("", ROOT), repository("packages/api", NESTED)],
        }),
      ],
      [
        threadView("agt-1", ROOT),
        threadView("agt-2", ROOT),
        threadView("agt-3", ROOT),
        threadView("agt-4", NESTED),
        threadView("agt-5", NESTED),
      ],
      [],
      ["agt-5", "agt-3"],
    );

    expect(groups[0]?.repos[0]?.threads.map((thread) => thread.record.owner.taskId)).toEqual([
      "agt-3",
      "agt-1",
      "agt-2",
    ]);
    expect(groups[0]?.repos[1]?.threads.map((thread) => thread.record.owner.taskId)).toEqual([
      "agt-5",
      "agt-4",
    ]);
  });

  it("orders pinned threads by pin time and keeps the incoming order for the rest", () => {
    const groups = agentProjectGroups(
      [project({ repositories: [repository("", ROOT)] })],
      [
        threadView("agt-1", ROOT),
        threadView("agt-2", ROOT),
        threadView("agt-3", ROOT),
        threadView("agt-4", ROOT),
      ],
      [],
      ["agt-4", "agt-1", "agt-9"],
    );

    expect(groups[0]?.repos[0]?.threads.map((thread) => thread.record.owner.taskId)).toEqual([
      "agt-4",
      "agt-1",
      "agt-2",
      "agt-3",
    ]);
    expect(groups[0]?.liveCount).toBe(0);
  });

  it("pins a detached thread within the detached group as well", () => {
    const groups = agentProjectGroups(
      [project({ repositories: [repository("", ROOT)] })],
      [
        threadView("agt-1", "/elsewhere/repo", undefined, "workspace-vanished"),
        threadView("agt-2", "/elsewhere/repo", undefined, "workspace-vanished"),
      ],
      [],
      ["agt-2"],
    );

    expect(groups[1]?.repos[0]?.threads.map((thread) => thread.record.owner.taskId)).toEqual([
      "agt-2",
      "agt-1",
    ]);
  });
});

function project(overrides: Partial<AgentProjectDescriptor>): AgentProjectDescriptor {
  const rootPath = overrides.rootPath ?? ROOT;
  return {
    rootKey: rootPath,
    rootPath,
    ownerId: `agent-root:${rootPath}`,
    label: "app",
    generation: 0,
    trust: "trusted",
    origin: "active-tab",
    repositories: [],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

function repository(rootRelativePath: string, repositoryRoot: string): ResolvedGitRepository {
  return { mapping: { rootRelativePath }, repositoryRoot, repositoryRelativePath: "" };
}

function threadView(
  taskId: string,
  repositoryRoot: string,
  status: AgentTaskRecord["status"] = { kind: "exited", exitCode: 0 },
  workspaceId: string = `agent-root:${ROOT}`,
): AgentTaskView {
  return {
    record: {
      owner: { taskId, workspaceId, repositoryRoot },
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
