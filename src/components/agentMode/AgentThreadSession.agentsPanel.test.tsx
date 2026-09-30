// @vitest-environment jsdom
import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { AgentAgentsPanelProvider } from "./agents/agentAgentsPanelContext";
import { AgentAgentsPanelSurface } from "./agents/AgentAgentsPanelSurface";
import { AgentThreadSession } from "./AgentThreadSession";
import { AGENT_SUBAGENT_ANNOUNCE_DELAY_MS } from "./AgentSubagentAnnouncer";

const spawn = (toolId: string, description: string): AgentTurnEvent => ({
  kind: "toolCall",
  toolId,
  name: "Agent",
  inputSummary: description,
  description,
});
const starting = (toolId: string): AgentTurnEvent => ({
  kind: "subagent",
  status: "starting",
  toolId,
  taskId: `task-${toolId}`,
});
const completed = (toolId: string): AgentTurnEvent => ({
  kind: "subagent",
  status: "completed",
  toolId,
  taskId: `task-${toolId}`,
});

const LIVE = [spawn("a", "Stream A"), spawn("b", "Stream B"), starting("a"), starting("b")];

function view(threadId: string, events: ReadonlyArray<AgentTurnEvent>): AgentThreadView {
  const turn: AgentTurn = {
    turnId: `${threadId}-t1`,
    prompt: "Delegate",
    status: { kind: "running" },
    events,
    startedAtEpochMs: 0,
    endedAtEpochMs: null,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
  return {
    thread: {
      threadId,
      owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
      target: { isolation: "in-place", worktreePath: null },
      provider: { kind: "claudeCode", sessionId: "session" },
      title: "Delegate",
      pinned: false,
      archived: false,
      createdAtEpochMs: 0,
      updatedAtEpochMs: 0,
      turns: [turn],
      turnsTruncated: false,
      integration: null,
      viewedAtEpochMs: null,
      externalOrigin: null,
    },
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: "running",
    unread: false,
    lifecycle: "running",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

function RightPanelHarness({
  thread,
  onOpened,
}: {
  readonly thread: AgentThreadView;
  readonly onOpened: () => void;
}) {
  const [open, setOpen] = useState(false);
  const onOpen = useCallback(() => {
    onOpened();
    setOpen(true);
  }, [onOpened]);
  const onToggle = useCallback(() => setOpen((current) => !current), []);
  return (
    <AgentAgentsPanelProvider isOpen={open} onOpen={onOpen} onToggle={onToggle}>
      <AgentThreadSession
        composerRepositoryLabel="app"
        onReviewInDiff={() => undefined}
        thread={thread}
      />
      {open && (
        <aside data-testid="right-panel">
          <AgentAgentsPanelSurface />
        </aside>
      )}
    </AgentAgentsPanelProvider>
  );
}

describe("thread Agents panel", () => {
  let host: HTMLDivElement;
  let root: Root;
  const opened = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    opened.mockReset();
  });

  function render(thread: AgentThreadView) {
    act(() => root.render(<RightPanelHarness onOpened={opened} thread={thread} />));
  }
  const indicator = () => host.querySelector<HTMLButtonElement>(".cv-live-row__action");
  const names = () =>
    [...host.querySelectorAll('[data-testid="right-panel"] .cv-agents-row__name')].map(
      (node) => node.textContent,
    );

  it("opens the right-panel surface through the provider and follows the thread on A, B, A", () => {
    render(view("thread-a", LIVE));
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    act(() => indicator()?.click());

    expect(opened).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(["Stream A", "Stream B"]);
    expect(document.activeElement).toBe(outside);

    render(view("thread-b", [spawn("z", "Stream Z"), starting("z")]));
    expect(names()).toEqual(["Stream Z"]);
    render(view("thread-a", LIVE));
    expect(names()).toEqual(["Stream A", "Stream B"]);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("keeps the thread in one plain column instead of docking or overlaying the panel", () => {
    render(view("thread-a", LIVE));
    act(() => indicator()?.click());
    const dock = host.querySelector<HTMLElement>(".agents-dock");

    expect(dock?.hasAttribute("data-agents")).toBe(false);
    expect(dock?.querySelector(".cv-agents")).toBeNull();
    expect(host.querySelector(".agents-dock__main")?.hasAttribute("inert")).toBe(false);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("announces subagent state through exactly one debounced polite region", () => {
    vi.useFakeTimers();
    render(view("thread-a", LIVE));
    act(() => indicator()?.click());
    const regions = () =>
      [...host.querySelectorAll('[role="status"], [aria-live]')].filter(
        (region) => !region.classList.contains("agent-tool-row-live"),
      );

    expect(regions()).toHaveLength(1);
    expect(
      host.querySelectorAll(
        ':is(.cv-spawn-list, .cv-agents, .cv-live-row) :is([role="status"], [aria-live])',
      ),
    ).toHaveLength(0);
    expect(regions()[0]?.getAttribute("aria-live")).toBe("polite");
    expect(regions()[0]?.textContent).toBe("");
    act(() => vi.advanceTimersByTime(AGENT_SUBAGENT_ANNOUNCE_DELAY_MS));
    expect(regions()[0]?.textContent).toBe("2 agents running");

    render(view("thread-a", [...LIVE, completed("a")]));
    render(view("thread-a", [...LIVE, completed("a"), completed("b")]));
    expect(regions()[0]?.textContent).toBe("2 agents running");
    act(() => vi.advanceTimersByTime(AGENT_SUBAGENT_ANNOUNCE_DELAY_MS));
    expect(regions()[0]?.textContent).toBe("All agents finished");
    expect(regions()).toHaveLength(1);
  });
});
