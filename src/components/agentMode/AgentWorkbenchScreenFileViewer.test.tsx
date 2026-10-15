// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentOutsideTextFile } from "../../application/agentOutsideLinkedFile";
import { AGENT_FILE_REVEAL_TIMEOUT_MS } from "../../application/rightPanel/useAgentFileRevealRequests";
import { createAgentFileViewerSessions } from "../../application/rightPanel/useAgentFileViewerSessions";
import type {
  AgentWorkbenchCommand,
  AgentWorkbenchLayoutState,
} from "../../application/useAgentWorkbenchLayout";
import { initialAgentWorkbenchLayout } from "../../domain/agentWorkbenchLayout";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  useAgentFileViewerLayout,
  useAgentFileViewerOpeners,
  type AgentFileViewerOpeners,
} from "./AgentWorkbenchScreenFileViewer";
import { useAgentLinkedFileOpener } from "./useAgentLinkedFileOpener";
import type { AgentFileLocationOpener } from "./useAgentLocalFileLinks";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.useRealTimers();
});

type RevealCommand = Extract<AgentWorkbenchCommand, { kind: "revealFile" }>;

function mount() {
  const sessions = createAgentFileViewerSessions();
  const commands: RevealCommand[] = [];
  const bound: Array<string | null> = [];
  const dispatch = (command: AgentWorkbenchCommand) => {
    if (command.kind === "revealFile") commands.push(command);
  };
  const workbench: AgentWorkbenchLayoutState = {
    layout: initialAgentWorkbenchLayout,
    effectiveLayout: "agent",
    persistedBottomPanel: false,
    dispatch,
    bindThread: (threadId) => bound.push(threadId),
  };
  const outside: { resolve: (file: AgentOutsideTextFile) => void } = { resolve: () => undefined };
  const captured: {
    openers: AgentFileViewerOpeners | null;
    layout: AgentWorkbenchLayoutState | null;
    linked: AgentFileLocationOpener | null;
  } = { openers: null, layout: null, linked: null };
  function Probe() {
    const openers = useAgentFileViewerOpeners(dispatch, sessions);
    captured.openers = openers;
    captured.layout = useAgentFileViewerLayout(workbench, sessions);
    captured.linked = useAgentLinkedFileOpener({
      files: { readDirectoryBounded: async () => ({ entries: [], truncated: false }) },
      outsideFiles: {
        readOutsideTextFile: () =>
          new Promise((resolve) => {
            outside.resolve = resolve;
          }),
      },
      workspace: { root: "/repo", tabs: ["/repo"], workspaceId: "ws", admissionToken: 1 },
      revealFileInViewer: openers.revealFileInViewer,
      showExternalFileInViewer: openers.showExternalFileInViewer,
      captureViewerOwner: openers.captureViewerOwner,
    });
    return null;
  }
  ui = mountUi();
  ui.render(<Probe />);
  const { layout, linked, openers } = captured;
  if (openers === null || layout === null || linked === null) throw new Error("not mounted");
  return { bound, commands, layout, linked, openers, outside, sessions };
}

describe("useAgentFileViewerOpeners", () => {
  it("dispatches a request-scoped reveal and resolves with that request's verdict", async () => {
    const { commands, openers, sessions } = mount();

    const accepted = openers.revealFileInViewer("/repo/src/a.ts", 4);
    const other = openers.revealFileInViewer("/repo/src/a.ts", 4);
    expect(commands).toEqual([
      { kind: "revealFile", path: "/repo/src/a.ts", line: 4, request: 1 },
      { kind: "revealFile", path: "/repo/src/a.ts", line: 4, request: 2 },
    ]);
    sessions.requests.settle(1, true);
    await expect(accepted).resolves.toBe(true);
    expect(sessions.requests.stateOf(2)).toBe("pending");
    sessions.requests.settle(2, false);
    await expect(other).resolves.toBe(false);
  });

  it("refuses an invalid path without dispatching and expires an unanswered reveal", async () => {
    vi.useFakeTimers();
    const { commands, openers, sessions } = mount();

    await expect(openers.revealFileInViewer("")).resolves.toBe(false);
    expect(commands).toEqual([]);

    const unanswered = openers.revealFileInViewer("/repo/src/a.ts");
    await act(async () => {
      vi.advanceTimersByTime(AGENT_FILE_REVEAL_TIMEOUT_MS);
    });
    await expect(unanswered).resolves.toBe(false);
    expect(sessions.requests.stateOf(1)).toBe("expired");
    expect(sessions.requests.pending(1, null, "/repo/src/a.ts", null)).toBeNull();
  });

  it("binds the viewer owner with the layout's thread binding", () => {
    const { bound, layout, openers } = mount();
    const before = openers.captureViewerOwner();

    layout.bindThread?.("agt-b");

    expect(bound).toEqual(["agt-b"]);
    expect(openers.captureViewerOwner()).toEqual({
      threadId: "agt-b",
      generation: before.generation + 1,
    });
  });

  it("drops an external read that settles after the thread changed", async () => {
    const { commands, layout, linked, outside } = mount();
    layout.bindThread?.("agt-a");

    const opened = linked({
      location: { path: "/home/me/notes.txt", line: 2, column: null },
      root: null,
    });
    layout.bindThread?.("agt-b");
    await act(async () => {
      outside.resolve({ kind: "file", canonicalPath: "/home/me/notes.txt", content: "notes" });
    });

    await expect(opened).resolves.not.toBe("opened");
    expect(commands).toEqual([]);
  });

  it("stages an external read for the thread that requested it", async () => {
    const { commands, layout, linked, outside, sessions } = mount();
    layout.bindThread?.("agt-a");

    const opened = linked({
      location: { path: "/home/me/notes.txt", line: 2, column: null },
      root: null,
    });
    await act(async () => {
      outside.resolve({ kind: "file", canonicalPath: "/home/me/notes.txt", content: "notes" });
    });

    expect(commands).toHaveLength(1);
    const request = commands[0]?.request ?? -1;
    expect(sessions.requests.pending(request, "agt-a", "/home/me/notes.txt", 2)).toMatchObject({
      payload: { kind: "external", path: "/home/me/notes.txt" },
    });
    sessions.requests.settle(request, true);
    await expect(opened).resolves.toBe("opened");
  });
});
