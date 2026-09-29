// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTasksNotice, AgentThreadView } from "../../application/agentThreadPorts";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import { agentThreadBulkOwnerKey } from "../../domain/agentThreadBulkAction";
import type { AgentProjectMenuTarget } from "./agentProjectMenuPresentation";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import {
  claudeSessionEndFailedNotice,
  claudeSessionEndedNotice,
  noClaudeSessionNotice,
} from "./useAgentEndSessionCommand";
import {
  CLIPBOARD_UNAVAILABLE_NOTICE,
  NOTHING_TO_COPY_NOTICE,
  REVEAL_FAILED_NOTICE,
  staleSelectionNotice,
  useAgentThreadMenuCommands,
  type AgentMenuCommandSurface,
  type AgentThreadMenuCommandOptions,
  type AgentThreadMenuCommands,
} from "./useAgentThreadMenuCommands";

const PROJECT_TARGET: AgentProjectMenuTarget = {
  projectRootKey: SURFACE_FIXTURE_ROOT,
  repositoryRoot: SURFACE_FIXTURE_ROOT,
  rootPath: SURFACE_FIXTURE_ROOT,
};

describe("useAgentThreadMenuCommands", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: AgentThreadMenuCommands | null;
  let notices: AgentTasksNotice[];
  let removed: string[];
  let started: Array<readonly [string, string]>;
  let terminalSessions: Array<readonly [string, string]>;
  let clipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
    notices = [];
    removed = [];
    started = [];
    terminalSessions = [];
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    if (clipboardDescriptor === undefined) {
      Reflect.deleteProperty(navigator, "clipboard");
      return;
    }
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  });

  it("routes snooze, settle, restore and relative reorder with structured values", () => {
    const updateThreadOrganization = vi.fn();
    const reorderThread = vi.fn();
    render({ agents: threadsSurfaceFixture({ updateThreadOrganization, reorderThread }) });
    act(() => {
      current().handleThreadMenuCommand("one", { kind: "snooze", until: 5000 });
      current().handleThreadMenuCommand("one", { kind: "settle" });
      current().handleThreadMenuCommand("one", { kind: "restore" });
      current().handleThreadMenuCommand("one", { kind: "moveBefore", targetThreadId: "two" });
    });
    expect(updateThreadOrganization.mock.calls).toEqual([
      ["one", { snoozedUntil: 5000, settledAt: null }],
      ["one", { settledAt: expect.any(Number), snoozedUntil: null }],
      ["one", { settledAt: null, snoozedUntil: null }],
    ]);
    expect(reorderThread).toHaveBeenCalledWith("one", "two", "before");
  });

  it("moves a pinned thread to Settled by unpinning and settling", () => {
    const togglePin = vi.fn();
    const updateThreadOrganization = vi.fn();
    const pinned = surfaceThreadView();
    render({
      agents: threadsSurfaceFixture({
        threads: [{ ...pinned, thread: { ...pinned.thread, pinned: true } }],
        togglePin,
        updateThreadOrganization,
      }),
    });
    act(() =>
      current().handleThreadMenuCommand("agt-1", { kind: "moveToSection", section: "settled" }),
    );
    expect(togglePin).toHaveBeenCalledWith("agt-1");
    expect(updateThreadOrganization).toHaveBeenCalledWith(
      "agt-1",
      expect.objectContaining({ settledAt: expect.any(Number) }),
    );
    act(() =>
      current().handleThreadMenuCommand("missing", { kind: "moveToSection", section: "pinned" }),
    );
    expect(togglePin).toHaveBeenCalledTimes(1);
  });

  it("does not forward server project actions to local project controls", () => {
    const revealPath = vi.fn(async () => undefined);
    const onTrustProject = vi.fn();
    const onCloseProject = vi.fn();
    const onReleaseProject = vi.fn();
    render({ revealPath, onTrustProject, onCloseProject, onReleaseProject });
    const remote = { ...PROJECT_TARGET, projectRootKey: "remote:server:project" };
    for (const command of ["trust", "close", "release", "reveal", "terminalSessions"] as const) {
      act(() => current().handleProjectCommand(remote, command));
    }
    expect(revealPath).not.toHaveBeenCalled();
    expect(onTrustProject).not.toHaveBeenCalled();
    expect(onCloseProject).not.toHaveBeenCalled();
    expect(onReleaseProject).not.toHaveBeenCalled();
    expect(terminalSessions).toEqual([]);
    expect(notices).toHaveLength(5);
  });

  it("routes project commands to trust, close, release, reveal, and copy", async () => {
    const writeText = installClipboard(async () => undefined);
    const onTrustProject = vi.fn();
    const onCloseProject = vi.fn();
    const onReleaseProject = vi.fn();
    const revealPath = vi.fn(async () => undefined);
    render({ onTrustProject, onCloseProject, onReleaseProject, revealPath });

    act(() => current().handleProjectCommand(PROJECT_TARGET, "trust"));
    act(() => current().handleProjectCommand(PROJECT_TARGET, "close"));
    act(() => current().handleProjectCommand(PROJECT_TARGET, "release"));
    await act(async () => current().handleProjectCommand(PROJECT_TARGET, "reveal"));
    await act(async () => current().handleProjectCommand(PROJECT_TARGET, "copyPath"));

    expect(onTrustProject).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(onCloseProject).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(onReleaseProject).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(revealPath).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(writeText).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(notices).toEqual([]);
  });

  it("opens terminal sessions for the gear menu target project", () => {
    render();

    act(() => current().handleProjectCommand(PROJECT_TARGET, "terminalSessions"));
    act(() =>
      current().handleProjectCommand(
        { ...PROJECT_TARGET, repositoryRoot: `${SURFACE_FIXTURE_ROOT}/packages/api` },
        "terminalSessions",
      ),
    );

    expect(terminalSessions).toEqual([
      [SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT],
      [SURFACE_FIXTURE_ROOT, `${SURFACE_FIXTURE_ROOT}/packages/api`],
    ]);
    expect(notices).toEqual([]);
  });

  it("reports a notice when reveal fails or the project has no path", async () => {
    render({ revealPath: async () => Promise.reject(new Error("denied")) });

    await act(async () => current().handleProjectCommand(PROJECT_TARGET, "reveal"));
    act(() => current().handleProjectCommand({ ...PROJECT_TARGET, rootPath: null }, "reveal"));
    act(() => current().handleProjectCommand({ ...PROJECT_TARGET, rootPath: null }, "copyPath"));

    expect(notices).toEqual([REVEAL_FAILED_NOTICE]);
  });

  it("routes thread commands to the surface and starts a new thread in the same repository", async () => {
    const agents = {
      ...threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        togglePin: vi.fn(),
        stop: vi.fn(async () => undefined),
        archive: vi.fn(() => true),
        remove: vi.fn(() => true),
        renameThread: vi.fn(),
        markThreadUnread: vi.fn(),
      }),
      unarchive: vi.fn(() => true),
    };
    render({ agents });

    act(() => current().handleThreadMenuCommand("agt-1", { kind: "togglePin" }));
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "stop" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "archive" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "unarchive" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "rename", title: "Renamed" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "markUnread" }));
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "delete" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "newThread" }));
    act(() => current().handleThreadMenuCommand("missing", { kind: "newThread" }));

    expect(agents.togglePin).toHaveBeenCalledWith("agt-1");
    expect(agents.stop).toHaveBeenCalledWith("agt-1");
    expect(agents.archive).toHaveBeenCalledWith("agt-1");
    expect(agents.unarchive).toHaveBeenCalledWith("agt-1");
    expect(agents.renameThread).toHaveBeenCalledWith("agt-1", "Renamed");
    expect(agents.markThreadUnread).toHaveBeenCalledWith("agt-1");
    expect(agents.remove).toHaveBeenCalledWith("agt-1");
    expect(removed).toEqual(["agt-1"]);
    expect(started).toEqual([[SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT]]);
  });

  it("ends the Claude session at once when no background tasks are live and says so", async () => {
    const endSession = vi.fn(async () => "ended" as const);
    const inspectSessionBackground = vi.fn(async () => "none" as const);
    render({
      agents: threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        endSession,
        inspectSessionBackground,
      }),
    });
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    expect(inspectSessionBackground).toHaveBeenCalledWith("agt-1");
    expect(endSession).toHaveBeenCalledWith("agt-1");
    expect(current().endSessionConfirmation).toBeNull();
    expect(notices).toEqual([claudeSessionEndedNotice("Refactor the parser")]);
  });

  it("tells the user when the thread had no Claude session to end", async () => {
    const endSession = vi.fn(async () => "none" as const);
    render({
      agents: threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        endSession,
        inspectSessionBackground: async () => "none" as const,
      }),
    });
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([noClaudeSessionNotice("Refactor the parser")]);
  });

  it("reports an error notice when ending the session failed", async () => {
    render({
      agents: threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        endSession: async () => "failed" as const,
        inspectSessionBackground: async () => "none" as const,
      }),
    });
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    expect(notices).toEqual([claudeSessionEndFailedNotice("Refactor the parser")]);
  });

  it("asks before ending a session with live background tasks and ends it on confirmation", async () => {
    const endSession = vi.fn(async () => "ended" as const);
    render({
      agents: threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        endSession,
        inspectSessionBackground: async () => "live" as const,
      }),
    });
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    expect(endSession).not.toHaveBeenCalled();
    expect(current().endSessionConfirmation).toMatchObject({ background: "live" });
    await act(async () => current().endSessionConfirmation?.onConfirm());
    expect(endSession).toHaveBeenCalledWith("agt-1");
    expect(current().endSessionConfirmation).toBeNull();
    expect(notices).toEqual([claudeSessionEndedNotice("Refactor the parser")]);
  });

  it("names the thread the confirmation concerns, even when another row asked", async () => {
    const endSession = vi.fn(async () => "ended" as const);
    const selected = surfaceThreadView();
    const other = surfaceThreadView({
      thread: { ...surfaceThreadView().thread, threadId: "agt-2", title: "Nightly build" },
    });
    const surface = (target: AgentThreadView) =>
      threadsSurfaceFixture({
        threads: [selected, target],
        endSession,
        inspectSessionBackground: async () => "live" as const,
      });
    render({ agents: surface(other) });
    await act(async () => current().handleThreadMenuCommand("agt-2", { kind: "endSession" }));
    expect(current().endSessionConfirmation).toMatchObject({
      threadId: "agt-2",
      title: "Nightly build",
      background: "live",
    });

    render({
      agents: surface({ ...other, thread: { ...other.thread, title: "Nightly build v2" } }),
    });
    expect(current().endSessionConfirmation).toMatchObject({
      threadId: "agt-2",
      title: "Nightly build v2",
    });
    await act(async () => current().endSessionConfirmation?.onConfirm());
    expect(endSession).toHaveBeenCalledWith("agt-2");
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([claudeSessionEndedNotice("Nightly build v2")]);
  });

  it("words every end session notice with the thread title", () => {
    expect(claudeSessionEndedNotice("Nightly build")).toEqual({
      kind: "info",
      message: 'Ended Claude\'s session for "Nightly build".',
      action: null,
    });
    expect(noClaudeSessionNotice("Nightly build")).toEqual({
      kind: "info",
      message: '"Nightly build" has no running Claude session, so there was nothing to end.',
      action: null,
    });
    expect(claudeSessionEndFailedNotice("Nightly build")).toEqual({
      kind: "error",
      message: 'Could not end Claude\'s session for "Nightly build".',
      action: null,
    });
  });

  it("keeps the session running when the confirmation is cancelled", async () => {
    const endSession = vi.fn(async () => "ended" as const);
    render({
      agents: threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        endSession,
        inspectSessionBackground: async () => "live" as const,
      }),
    });
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    act(() => current().endSessionConfirmation?.onCancel());
    expect(current().endSessionConfirmation).toBeNull();
    expect(endSession).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it("asks when the background check could not answer", async () => {
    const endSession = vi.fn(async () => "ended" as const);
    render({
      agents: threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        endSession,
        inspectSessionBackground: async () => "unknown" as const,
      }),
    });
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    expect(endSession).not.toHaveBeenCalled();
    expect(current().endSessionConfirmation).toMatchObject({ background: "unknown" });
  });

  it("drops a pending confirmation once the thread runs again or disappears", async () => {
    const endSession = vi.fn(async () => "ended" as const);
    const idle = surfaceThreadView();
    const surface = (threads: ReadonlyArray<AgentThreadView>) =>
      threadsSurfaceFixture({
        threads,
        endSession,
        inspectSessionBackground: async () => "live" as const,
      });
    render({ agents: surface([idle]) });
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    expect(current().endSessionConfirmation).not.toBeNull();
    render({ agents: surface([{ ...idle, lifecycle: "running" }]) });
    expect(current().endSessionConfirmation).toBeNull();
    render({ agents: surface([idle]) });
    expect(current().endSessionConfirmation).toBeNull();

    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    render({ agents: surface([]) });
    expect(current().endSessionConfirmation).toBeNull();
    expect(endSession).not.toHaveBeenCalled();
  });

  it("only the latest End Claude session request may ask", async () => {
    const answers: Array<(value: "live" | "none") => void> = [];
    const endSession = vi.fn(async () => "ended" as const);
    render({
      agents: threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        endSession,
        inspectSessionBackground: () =>
          new Promise<"live" | "none">((resolve) => {
            answers.push(resolve);
          }),
      }),
    });
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    await act(async () => answers[1]?.("live"));
    await act(async () => answers[0]?.("none"));
    expect(endSession).not.toHaveBeenCalled();
    expect(current().endSessionConfirmation).toMatchObject({ background: "live" });
  });

  it("ignores End Claude session when the surface has no session support", async () => {
    render({ agents: threadsSurfaceFixture({ threads: [surfaceThreadView()] }) });
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "endSession" }));
    expect(notices).toEqual([]);
  });

  it("keeps the selection when the surface refuses to delete the thread", async () => {
    const agents = threadsSurfaceFixture({
      threads: [surfaceThreadView()],
      remove: vi.fn(() => false),
    });
    render({ agents });

    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "delete" }));

    expect(agents.remove).toHaveBeenCalledWith("agt-1");
    expect(removed).toEqual([]);
  });

  it("copies a thread detail and falls back to notices when nothing or no clipboard is available", async () => {
    const writeText = installClipboard(async () => undefined);
    render({
      agents: threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        threadCopyDetail: (_threadId, detail) => (detail === "branch" ? "agent/agt-1" : null),
      }),
    });

    await act(async () =>
      current().handleThreadMenuCommand("agt-1", { kind: "copy", detail: "branch" }),
    );
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "copy", detail: "path" }));

    expect(writeText).toHaveBeenCalledWith("agent/agt-1");
    expect(notices).toEqual([NOTHING_TO_COPY_NOTICE]);

    installClipboard(async () => Promise.reject(new Error("blocked")));
    await act(async () =>
      current().handleThreadMenuCommand("agt-1", { kind: "copy", detail: "branch" }),
    );
    expect(notices).toEqual([NOTHING_TO_COPY_NOTICE, CLIPBOARD_UNAVAILABLE_NOTICE]);

    Reflect.deleteProperty(navigator, "clipboard");
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "copy", detail: "branch" }));
    expect(notices).toEqual([
      NOTHING_TO_COPY_NOTICE,
      CLIPBOARD_UNAVAILABLE_NOTICE,
      CLIPBOARD_UNAVAILABLE_NOTICE,
    ]);
  });

  it("archives only the threads a bulk selection may legitimately archive", async () => {
    const agents = threadsSurfaceFixture({
      threads: [
        surfaceThreadView(),
        runningView("agt-run"),
        archivedView("agt-old"),
        foreignView("agt-foreign"),
      ],
      archive: vi.fn(() => true),
      remove: vi.fn(() => true),
    });
    render({ agents });

    await act(async () =>
      current().handleThreadBulkCommand({
        kind: "apply",
        request: {
          action: "archive",
          threadIds: ["agt-1", "agt-run", "agt-old", "agt-foreign"],
          ownerKeys: capturedOwners(["agt-1", "agt-run", "agt-old", "agt-foreign"]),
          missingIds: ["agt-gone"],
        },
      }),
    );

    expect(agents.archive).toHaveBeenCalledTimes(1);
    expect(agents.archive).toHaveBeenCalledWith("agt-1");
    expect(agents.remove).not.toHaveBeenCalled();
    expect(notices).toEqual([
      {
        kind: "info",
        message:
          "Archived 1 thread. Skipped 4: 1 still running, 1 already archived, 1 no longer in this list, 1 owned by another project.",
        action: null,
      },
    ]);
  });

  it("skips a thread whose owner was rebound after it was selected", async () => {
    const rebound = surfaceThreadView();
    const agents = threadsSurfaceFixture({
      threads: [
        {
          ...rebound,
          thread: {
            ...rebound.thread,
            owner: { ...rebound.thread.owner, ownerId: "agent-root:app:reopened" },
          },
        },
      ],
      archive: vi.fn(() => true),
      remove: vi.fn(() => true),
    });
    render({ agents });

    await act(async () =>
      current().handleThreadBulkCommand({
        kind: "apply",
        request: {
          action: "delete",
          threadIds: ["agt-1"],
          ownerKeys: capturedOwners(["agt-1"]),
          missingIds: [],
        },
      }),
    );

    expect(agents.remove).not.toHaveBeenCalled();
    expect(notices).toEqual([
      {
        kind: "info",
        message: "Deleted 0 threads. Skipped 1: 1 owned by another project.",
        action: null,
      },
    ]);
  });

  it("never routes a running thread into a bulk delete the surface would refuse", async () => {
    const agents = threadsSurfaceFixture({
      threads: [surfaceThreadView(), runningView("agt-run"), foreignView("agt-foreign")],
      archive: vi.fn(() => true),
      remove: vi.fn(() => true),
    });
    render({ agents });

    await act(async () =>
      current().handleThreadBulkCommand({
        kind: "apply",
        request: {
          action: "delete",
          threadIds: ["agt-1", "agt-run", "agt-foreign"],
          ownerKeys: capturedOwners(["agt-1", "agt-run", "agt-foreign"]),
          missingIds: [],
        },
      }),
    );

    expect(agents.remove).toHaveBeenCalledTimes(1);
    expect(removed).toEqual(["agt-1"]);
    expect(notices).toEqual([
      {
        kind: "info",
        message: "Deleted 1 thread. Skipped 2: 1 still running, 1 owned by another project.",
        action: null,
      },
    ]);
  });

  it("awaits server saves with bounded concurrency and reports the real outcome", async () => {
    const ids = ["srv-1", "srv-2", "srv-3", "srv-4", "srv-5", "srv-6"];
    const pending = new Map<string, (ok: boolean) => void>();
    let inFlight = 0;
    let peak = 0;
    const archive = vi.fn(
      (threadId: string) =>
        new Promise<boolean>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          pending.set(threadId, (ok) => {
            inFlight -= 1;
            resolve(ok);
          });
        }),
    );
    const agents = threadsSurfaceFixture({
      threads: ids.map((threadId) => ({
        ...surfaceThreadView(),
        thread: { ...surfaceThreadView().thread, threadId },
      })),
      archive,
    });
    render({ agents });

    act(() =>
      current().handleThreadBulkCommand({
        kind: "apply",
        request: {
          action: "archive",
          threadIds: ids,
          ownerKeys: capturedOwners(ids),
          missingIds: [],
        },
      }),
    );
    for (const threadId of ids) {
      await act(async () => {
        await vi.waitFor(() => expect(pending.has(threadId)).toBe(true));
        pending.get(threadId)?.(threadId !== "srv-2" && threadId !== "srv-5");
      });
    }
    await act(async () => {
      await vi.waitFor(() => expect(notices).toHaveLength(1));
    });

    expect(archive).toHaveBeenCalledTimes(6);
    expect(peak).toBeLessThanOrEqual(2);
    expect(notices).toEqual([
      {
        kind: "warning",
        message: "Archived 4 threads. Failed 2: the change could not be saved.",
        action: null,
      },
    ]);
  });

  it("wraps a bulk run in one mutation batch", async () => {
    const order: string[] = [];
    const agents: AgentMenuCommandSurface = {
      ...threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        archive: vi.fn(() => {
          order.push("archive");
          return true;
        }),
      }),
      batchThreadMutations: async <T,>(work: () => Promise<T>) => {
        order.push("begin");
        const result = await work();
        order.push("end");
        return result;
      },
    };
    render({ agents });

    await act(async () =>
      current().handleThreadBulkCommand({
        kind: "apply",
        request: {
          action: "archive",
          threadIds: ["agt-1"],
          ownerKeys: capturedOwners(["agt-1"]),
          missingIds: [],
        },
      }),
    );

    expect(order).toEqual(["begin", "archive", "end"]);
    expect(notices).toEqual([{ kind: "info", message: "Archived 1 thread.", action: null }]);
  });

  it("touches nothing when the selection was captured under another workspace generation", () => {
    const agents = threadsSurfaceFixture({
      threads: [surfaceThreadView()],
      archive: vi.fn(),
      remove: vi.fn(),
    });
    render({ agents });

    act(() => current().handleThreadBulkCommand({ kind: "stale", action: "delete" }));

    expect(agents.archive).not.toHaveBeenCalled();
    expect(agents.remove).not.toHaveBeenCalled();
    expect(notices).toEqual([staleSelectionNotice("delete")]);
  });

  function runningView(threadId: string): AgentThreadView {
    const base = surfaceThreadView();
    return {
      ...base,
      thread: {
        ...base.thread,
        threadId,
        turns: [
          {
            turnId: `${threadId}-t1`,
            prompt: "work",
            status: { kind: "running" },
            startedAtEpochMs: 1_700_000_000_000,
            endedAtEpochMs: null,
            events: [],
            eventsTruncated: false,
            lastStatusSequence: 0,
            lastOutputSequence: 0,
            launch: null,
            cliVersion: null,
          },
        ],
      },
    };
  }

  function archivedView(threadId: string): AgentThreadView {
    const base = surfaceThreadView();
    return { ...base, thread: { ...base.thread, threadId, archived: true } };
  }

  function foreignView(threadId: string): AgentThreadView {
    const base = surfaceThreadView();
    return {
      ...base,
      thread: {
        ...base.thread,
        threadId,
        owner: { ...base.thread.owner, rootKey: "/workspace/other" },
      },
    };
  }

  function installClipboard(writeText: (text: string) => Promise<void>) {
    const spy = vi.fn(writeText);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: spy },
    });
    return spy;
  }

  function render(overrides: Partial<AgentThreadMenuCommandOptions> = {}): void {
    const agents: AgentMenuCommandSurface = overrides.agents ?? threadsSurfaceFixture();
    const options: AgentThreadMenuCommandOptions = {
      agents,
      groups: agentProjectGroups([projectFixture()], agents.threads, []),
      revealPath: async () => undefined,
      reportNotice: (notice) => notices.push(notice),
      onTrustProject: () => undefined,
      onCloseProject: () => undefined,
      onReleaseProject: () => undefined,
      onThreadRemoved: (threadId) => removed.push(threadId),
      onOpenTerminalSessions: (projectRootKey, repositoryRoot) =>
        terminalSessions.push([projectRootKey, repositoryRoot]),
      startNewThread: (projectRootKey, repositoryRoot) =>
        started.push([projectRootKey, repositoryRoot]),
      ...overrides,
    };
    act(() => {
      root.render(<Harness options={options} />);
    });
  }

  function current(): AgentThreadMenuCommands {
    expect(captured).not.toBeNull();
    return captured as AgentThreadMenuCommands;
  }

  function Harness({ options }: { readonly options: AgentThreadMenuCommandOptions }) {
    captured = useAgentThreadMenuCommands(options);
    return null;
  }
});

function capturedOwners(threadIds: ReadonlyArray<string>): ReadonlyMap<string, string> {
  const owner = agentThreadBulkOwnerKey({
    rootKey: SURFACE_FIXTURE_ROOT,
    ownerId: "agent-root:app",
  });
  return new Map(threadIds.map((threadId) => [threadId, owner]));
}
