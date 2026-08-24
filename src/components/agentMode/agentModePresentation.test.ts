import { describe, expect, it } from "vitest";
import type { AgentProjectDescriptor, AgentProjectOrigin } from "../../domain/agentProject";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentThread, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import type { ResolvedGitRepository } from "../../domain/gitRepositoryMapping";
import type { AgentThreadView, OrphanedWorktreeView } from "../../application/agentThreadPorts";
import {
  DETACHED_AGENT_PROJECT_LABEL,
  DETACHED_AGENT_PROJECT_ROOT_KEY,
  MAX_RENDERED_EVENTS_PER_TURN,
  agentChangeStatusLetter,
  agentCliKindLabel,
  agentFollowUpBlockedReason,
  agentIsolationBadgeLabel,
  agentIsolationBadgeReason,
  agentIsolationReasonLabel,
  agentProjectGroups,
  agentProjectOriginBadge,
  agentProjectTrustNotice,
  agentProjectWorktreeOnly,
  agentProjectWorktreeOnlyReason,
  agentPromptByteLength,
  agentThreadDisplayTitle,
  agentThreadLifecycleLabel,
  agentThreadTimeLabel,
  agentThreadTone,
  agentTurnProjection,
  agentTurnStatusLabel,
  inPlaceGuardReasonLabel,
  type AgentFollowUpContext,
} from "./agentModePresentation";

const ROOT = "/workspace/app";
const NESTED = "/workspace/app/packages/api";
const OTHER_ROOT = "/workspace/api-service";

describe("agentModePresentation", () => {
  it("labels every thread lifecycle", () => {
    expect(agentThreadLifecycleLabel("running")).toBe("Running");
    expect(agentThreadLifecycleLabel("settled")).toBe("Idle");
    expect(agentThreadLifecycleLabel("archived")).toBe("Archived");
  });

  it("labels every turn status including an interrupted one", () => {
    expect(agentTurnStatusLabel({ kind: "pending" })).toBe("Queued");
    expect(agentTurnStatusLabel({ kind: "running" })).toBe("Running");
    expect(agentTurnStatusLabel({ kind: "exited", exitCode: 0 })).toBe("Finished");
    expect(agentTurnStatusLabel({ kind: "exited", exitCode: 2 })).toBe("Exited 2");
    expect(agentTurnStatusLabel({ kind: "failed", message: "boom" })).toBe("Failed");
    expect(agentTurnStatusLabel({ kind: "stopped" })).toBe("Stopped");
    expect(agentTurnStatusLabel({ kind: "interrupted" })).toBe("Interrupted");
  });

  it("tones a thread from its lifecycle and its last turn status", () => {
    expect(agentThreadTone("archived", { kind: "exited", exitCode: 0 })).toBe("archived");
    expect(agentThreadTone("running", { kind: "running" })).toBe("running");
    expect(agentThreadTone("running", { kind: "pending" })).toBe("queued");
    expect(agentThreadTone("settled", { kind: "exited", exitCode: 0 })).toBe("done");
    expect(agentThreadTone("settled", { kind: "exited", exitCode: 2 })).toBe("failed");
    expect(agentThreadTone("settled", { kind: "failed", message: "boom" })).toBe("failed");
    expect(agentThreadTone("settled", { kind: "stopped" })).toBe("stopped");
    expect(agentThreadTone("settled", { kind: "interrupted" })).toBe("stopped");
    expect(agentThreadTone("settled", null)).toBe("queued");
  });

  it("falls back to a named title instead of rendering an empty one", () => {
    expect(agentThreadDisplayTitle(thread({ title: "Rename the port" }).thread)).toBe(
      "Rename the port",
    );
    expect(agentThreadDisplayTitle(thread({ title: "   " }).thread)).toBe("Untitled thread");
  });

  it("counts prompt bytes in UTF-8", () => {
    expect(agentPromptByteLength("abc")).toBe(3);
    expect(agentPromptByteLength("🚀")).toBe(4);
  });

  it("blocks a follow-up for every unusable thread state and allows a resumable one", () => {
    expect(blockedReason(thread({}))).toBeNull();
    expect(blockedReason(thread({ archived: true }))).toContain("archived");
    expect(blockedReason(thread({ worktreeMissing: true }))).toContain("no longer exists");
    expect(blockedReason(thread({ status: { kind: "running" } }))).toContain("still running");
    expect(blockedReason(thread({ sessionId: null }))).toContain("no resumable session");
  });

  it("labels every agent CLI kind", () => {
    expect(agentCliKindLabel("claudeCode")).toBe("Claude Code");
    expect(agentCliKindLabel("codex")).toBe("Codex");
  });

  it("blocks a follow-up whose thread belongs to a project being released", () => {
    expect(blockedReason(thread({ projectOrigin: "closed-tab-live-tasks" }))).toBe(
      "This thread's project is being released, so it cannot continue.",
    );
    expect(blockedReason(thread({ projectOrigin: "background-tab" }))).toBeNull();
  });

  it("blocks a follow-up whose provider no longer matches the configured CLI", () => {
    expect(blockedReason(thread({ providerKind: "claudeCode" }), { agentCliKind: "codex" })).toBe(
      "This thread was started with Claude Code; start a new thread.",
    );
    expect(blockedReason(thread({ providerKind: "codex" }))).toBe(
      "This thread was started with Codex; start a new thread.",
    );
  });

  it("blocks a follow-up while no agent CLI is configured", () => {
    expect(blockedReason(thread({}), { agentCliConfigured: false })).toBe(
      "No agent CLI is configured. Set the agent CLI path in settings.",
    );
  });

  it("blocks a follow-up once the concurrent agent limit is reached", () => {
    expect(blockedReason(thread({}), { liveTaskCount: 4, maxConcurrentAgentTasks: 4 })).toBe(
      "The concurrent agent limit is reached. Stop a running agent or raise the limit.",
    );
    expect(blockedReason(thread({}), { liveTaskCount: 3, maxConcurrentAgentTasks: 4 })).toBeNull();
  });

  it("orders the follow-up reasons from the most final state to the most transient one", () => {
    const steps: ReadonlyArray<{
      readonly cleared: ThreadOptions;
      readonly context: Partial<AgentFollowUpContext>;
      readonly expected: string;
    }> = [
      { cleared: {}, context: {}, expected: "archived" },
      { cleared: { archived: false }, context: {}, expected: "no longer exists" },
      { cleared: { worktreeMissing: false }, context: {}, expected: "still running" },
      {
        cleared: { status: { kind: "exited", exitCode: 0 } },
        context: {},
        expected: "being released",
      },
      { cleared: { projectOrigin: "active-tab" }, context: {}, expected: "started with Codex" },
      { cleared: { providerKind: "claudeCode" }, context: {}, expected: "no resumable session" },
      {
        cleared: { sessionId: "session-abcdefgh" },
        context: {},
        expected: "No agent CLI is configured",
      },
      { cleared: {}, context: { agentCliConfigured: true }, expected: "concurrent agent limit" },
    ];

    let options: ThreadOptions = {
      archived: true,
      worktreeMissing: true,
      status: { kind: "running" },
      projectOrigin: "closed-tab-live-tasks",
      providerKind: "codex",
      sessionId: null,
    };
    let context: Partial<AgentFollowUpContext> = {
      agentCliConfigured: false,
      liveTaskCount: 9,
      maxConcurrentAgentTasks: 1,
    };

    for (const step of steps) {
      options = { ...options, ...step.cleared };
      context = { ...context, ...step.context };
      expect(blockedReason(thread(options), context)).toContain(step.expected);
    }
  });

  it("projects assistant text, reasoning and paired tool calls", () => {
    const projection = agentTurnProjection([
      { kind: "assistantText", text: "One.\n\nTwo." },
      { kind: "reasoning", text: "Thinking." },
      { kind: "toolCall", toolId: "t-1", name: "Read", inputSummary: "a.ts" },
      { kind: "toolResult", toolId: "t-1", outputSummary: "12 lines", isError: false },
      { kind: "unknownLine", stream: "stderr", raw: "warn", clipped: false },
    ]);

    expect(projection.hiddenCount).toBe(0);
    expect(projection.items.map((item) => item.kind)).toEqual([
      "assistantText",
      "reasoning",
      "tool",
    ]);
    expect(projection.items[0]).toMatchObject({ paragraphs: ["One.", "Two."] });
    expect(projection.items[2]).toMatchObject({
      name: "Read",
      inputSummary: "a.ts",
      outcome: { outputSummary: "12 lines", isError: false },
    });
    expect(projection.rawLines.map((line) => line.raw)).toEqual(["warn"]);
  });

  it("names an orphan tool result from the call that fell outside the window", () => {
    const events: AgentTurnEvent[] = [
      { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm test" },
      ...Array.from({ length: MAX_RENDERED_EVENTS_PER_TURN - 1 }, (): AgentTurnEvent => ({
        kind: "assistantText",
        text: "noise",
      })),
      { kind: "toolResult", toolId: "t-1", outputSummary: "exit 1", isError: true },
    ];
    const projection = agentTurnProjection(events);

    expect(projection.hiddenCount).toBe(1);
    expect(projection.items[projection.items.length - 1]).toMatchObject({
      kind: "tool",
      name: "Bash",
      inputSummary: "npm test",
      outcome: { isError: true },
    });
  });

  it("renders only the last window of events and reports the hidden count", () => {
    const events: AgentTurnEvent[] = Array.from(
      { length: MAX_RENDERED_EVENTS_PER_TURN + 5 },
      (_unused, index): AgentTurnEvent => ({ kind: "assistantText", text: `line ${index}` }),
    );
    const projection = agentTurnProjection(events);

    expect(projection.hiddenCount).toBe(5);
    expect(projection.items).toHaveLength(MAX_RENDERED_EVENTS_PER_TURN);
    expect(projection.items[0]).toMatchObject({ paragraphs: ["line 5"] });
  });

  it("keeps a tool call without a result open", () => {
    const projection = agentTurnProjection([
      { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm test" },
    ]);

    expect(projection.items[0]).toMatchObject({ kind: "tool", outcome: null });
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

  it("explains every isolation recommendation and in-place guard reason", () => {
    expect(agentIsolationReasonLabel({ kind: "in-place" })).toContain("clean");
    expect(agentIsolationReasonLabel({ kind: "worktree", reason: "policy" })).toContain(
      "always isolates",
    );
    expect(agentIsolationReasonLabel({ kind: "worktree", reason: "agent-active" })).toContain(
      "Another agent",
    );
    expect(agentIsolationReasonLabel({ kind: "worktree", reason: "parallel-dispatch" })).toContain(
      "at once",
    );
    expect(agentIsolationReasonLabel({ kind: "worktree", reason: "status-unknown" })).toContain(
      "unknown",
    );
    expect(agentIsolationReasonLabel({ kind: "worktree", reason: "dirty-tree" })).toContain(
      "uncommitted",
    );
    expect(agentIsolationReasonLabel({ kind: "worktree", reason: "dirty-editors" })).toContain(
      "unsaved editors",
    );

    expect(inPlaceGuardReasonLabel("agent-active")).toContain("another agent");
    expect(inPlaceGuardReasonLabel("dirty-tree")).toContain("uncommitted");
    expect(inPlaceGuardReasonLabel("dirty-editors")).toContain("unsaved editors");
    expect(inPlaceGuardReasonLabel("status-unknown")).toContain("unknown");
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
      [
        thread({ threadId: "agt-1", repositoryRoot: ROOT, status: { kind: "running" } }),
        thread({ threadId: "agt-2", repositoryRoot: ROOT }),
      ],
      [orphan(ROOT, `${ROOT}/.worktrees/agt-9`)],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("project");
    expect(groups[0]?.label).toBe("app");
    expect(groups[0]?.singleRepo).toBe(true);
    expect(groups[0]?.repos).toHaveLength(1);
    expect(threadIds(groups[0]?.repos[0]?.threads)).toEqual(["agt-1", "agt-2"]);
    expect(groups[0]?.repos[0]?.orphans).toHaveLength(1);
    expect(groups[0]?.liveCount).toBe(1);
  });

  it("splits archived threads out of the active list of their repository", () => {
    const groups = agentProjectGroups(
      [project({ repositories: [repository("", ROOT)] })],
      [
        thread({ threadId: "agt-1", repositoryRoot: ROOT }),
        thread({ threadId: "agt-2", repositoryRoot: ROOT, archived: true }),
      ],
      [],
    );

    expect(threadIds(groups[0]?.repos[0]?.threads)).toEqual(["agt-1"]);
    expect(threadIds(groups[0]?.repos[0]?.archived)).toEqual(["agt-2"]);
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
        thread({ threadId: "agt-1", repositoryRoot: ROOT, status: { kind: "running" } }),
        thread({ threadId: "agt-2", repositoryRoot: NESTED, status: { kind: "running" } }),
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
      [thread({ threadId: "agt-1", repositoryRoot: NESTED })],
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
      [
        thread({
          threadId: "agt-1",
          repositoryRoot: NESTED,
          status: { kind: "running" },
          ownerId: monorepoOwner,
        }),
      ],
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
    expect(threadIds(monorepo?.repos[1]?.threads)).toEqual(["agt-1"]);
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
        thread({ threadId: "agt-1", repositoryRoot: ROOT }),
        thread({
          threadId: "agt-3",
          repositoryRoot: "/elsewhere/repo",
          ownerId: "agent-root:vanished",
        }),
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
      [project({ repositories: [repository("", ROOT), repository("packages/api", NESTED)] })],
      [
        thread({ threadId: "agt-1", repositoryRoot: ROOT }),
        thread({ threadId: "agt-2", repositoryRoot: ROOT }),
        thread({ threadId: "agt-3", repositoryRoot: ROOT, pinned: true }),
        thread({ threadId: "agt-4", repositoryRoot: NESTED }),
        thread({ threadId: "agt-5", repositoryRoot: NESTED, pinned: true }),
      ],
      [],
    );

    expect(threadIds(groups[0]?.repos[0]?.threads)).toEqual(["agt-3", "agt-1", "agt-2"]);
    expect(threadIds(groups[0]?.repos[1]?.threads)).toEqual(["agt-5", "agt-4"]);
  });

  it("keeps the incoming order of pinned and unpinned threads stable", () => {
    const groups = agentProjectGroups(
      [project({ repositories: [repository("", ROOT)] })],
      [
        thread({ threadId: "agt-1", repositoryRoot: ROOT, pinned: true }),
        thread({ threadId: "agt-2", repositoryRoot: ROOT }),
        thread({ threadId: "agt-3", repositoryRoot: ROOT }),
        thread({ threadId: "agt-4", repositoryRoot: ROOT, pinned: true }),
      ],
      [],
    );

    expect(threadIds(groups[0]?.repos[0]?.threads)).toEqual(["agt-1", "agt-4", "agt-2", "agt-3"]);
    expect(groups[0]?.liveCount).toBe(0);
  });

  it("pins a detached thread within the detached group as well", () => {
    const groups = agentProjectGroups(
      [project({ repositories: [repository("", ROOT)] })],
      [
        thread({
          threadId: "agt-1",
          repositoryRoot: "/elsewhere/repo",
          ownerId: "agent-root:vanished",
        }),
        thread({
          threadId: "agt-2",
          repositoryRoot: "/elsewhere/repo",
          ownerId: "agent-root:vanished",
          pinned: true,
        }),
      ],
      [],
    );

    expect(threadIds(groups[1]?.repos[0]?.threads)).toEqual(["agt-2", "agt-1"]);
  });
});

function blockedReason(
  view: AgentThreadView,
  context: Partial<AgentFollowUpContext> = {},
): string | null {
  return agentFollowUpBlockedReason(view, {
    agentCliKind: "claudeCode",
    agentCliConfigured: true,
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 4,
    ...context,
  });
}

function threadIds(views: ReadonlyArray<AgentThreadView> | undefined): ReadonlyArray<string> {
  return (views ?? []).map((view) => view.thread.threadId);
}

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

interface ThreadOptions {
  readonly threadId?: string;
  readonly repositoryRoot?: string;
  readonly ownerId?: string;
  readonly status?: AgentTurnStatus;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly providerKind?: AgentCliKind;
  readonly projectOrigin?: AgentProjectOrigin;
  readonly sessionId?: string | null;
  readonly title?: string;
  readonly worktreeMissing?: boolean;
}

function thread({
  archived = false,
  ownerId = `agent-root:${ROOT}`,
  pinned = false,
  projectOrigin = "active-tab",
  providerKind = "claudeCode",
  repositoryRoot = ROOT,
  sessionId = "session-abcdefgh",
  status = { kind: "exited", exitCode: 0 },
  threadId = "agt-1",
  title = "Refactor the parser",
  worktreeMissing = false,
}: ThreadOptions): AgentThreadView {
  const running = status.kind === "pending" || status.kind === "running";
  const record: AgentThread = {
    threadId,
    owner: { rootKey: ROOT, ownerId, repositoryRoot },
    target: { isolation: "worktree", worktreePath: `${repositoryRoot}/.worktrees/${threadId}` },
    provider: { kind: providerKind, sessionId },
    title,
    pinned,
    archived,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [
      {
        turnId: `${threadId}-t1`,
        prompt: title,
        status,
        startedAtEpochMs: 1_700_000_000_000,
        endedAtEpochMs: null,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
      },
    ],
    turnsTruncated: false,
  };

  return {
    thread: record,
    lifecycle: archived ? "archived" : running ? "running" : "settled",
    repositoryLabel: repositoryRoot,
    projectOrigin,
    worktreeRemoved: false,
    worktreeMissing,
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
