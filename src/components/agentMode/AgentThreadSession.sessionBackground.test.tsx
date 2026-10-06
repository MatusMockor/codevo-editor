// @vitest-environment jsdom
import { act, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentAgentsPanelProvider } from "./agents/agentAgentsPanelContext";
import { AgentAgentsPanelSurface } from "./agents/AgentAgentsPanelSurface";
import { agentRunningStopReasonText } from "./agents/agentRunningWork";
import { AgentThreadSession } from "./AgentThreadSession";

const RESUMED_AT = 1_790_718_781_369;

const resumeTurn: AgentTurn = {
  turnId: "agt-mun7q6rd-9777",
  prompt: "Claude continued after background work finished",
  origin: "background",
  status: { kind: "exited", exitCode: 0 },
  startedAtEpochMs: RESUMED_AT,
  endedAtEpochMs: RESUMED_AT,
  events: [
    {
      kind: "toolCall",
      toolId: "toolu_019eyG6GAy4aZoYrH76mTu6u",
      name: "SendMessage",
      inputSummary: '{"to":"a4b355dcf6056a875","summary":"Your reviewer\'s findings"}',
    },
    {
      kind: "subagent",
      status: "starting",
      toolId: "toolu_019eyG6GAy4aZoYrH76mTu6u",
      taskId: "a4b355dcf6056a875",
      subagentType: "general-purpose",
      description: "Live Codex model catalog like Claude",
    },
    {
      kind: "backgroundTask",
      taskId: "a4b355dcf6056a875",
      status: "starting",
      taskType: "agent",
      description: "Live Codex model catalog like Claude",
    },
    {
      kind: "result",
      text: "Agent teraz opravuje dve stredne vazne chyby.",
      isError: false,
      usage: null,
    },
  ],
  eventsTruncated: false,
  lastStatusSequence: 0,
  lastOutputSequence: 0,
  launch: null,
  cliVersion: null,
};

const resumedAgent: AgentSessionBackground = {
  ownerId: "owner",
  total: 1,
  agents: 1,
  tasks: [
    {
      taskId: "a4b355dcf6056a875",
      taskType: "agent",
      description: "Live Codex model catalog like Claude",
    },
  ],
  sinceEpochMs: RESUMED_AT,
  taskSinceEpochMs: new Map(),
  reply: { kind: "none" },
};

const replyOnly: AgentSessionBackground = {
  ownerId: "owner",
  total: 0,
  agents: 0,
  tasks: [],
  sinceEpochMs: RESUMED_AT,
  taskSinceEpochMs: new Map(),
  reply: { kind: "inProgress", sinceEpochMs: RESUMED_AT },
};

function PanelHarness({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const onOpen = useCallback(() => setOpen(true), []);
  const onToggle = useCallback(() => setOpen((current) => !current), []);
  return (
    <AgentAgentsPanelProvider isOpen={open} onOpen={onOpen} onToggle={onToggle}>
      {children}
      {open && (
        <aside data-testid="right-panel">
          <AgentAgentsPanelSurface />
        </aside>
      )}
    </AgentAgentsPanelProvider>
  );
}

describe("thread session with live session background work", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(
    sessionBackground: AgentSessionBackground | undefined,
    onStopSessionTask?: (threadId: string, taskId: string) => void,
  ) {
    const view: AgentThreadView = {
      thread: {
        threadId: "agt-mue1wenj-7ede",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: "claudeCode", sessionId: "session" },
        title: "Codex model catalog",
        pinned: false,
        archived: false,
        createdAtEpochMs: 0,
        updatedAtEpochMs: 0,
        turns: [resumeTurn],
        turnsTruncated: false,
        integration: null,
        viewedAtEpochMs: null,
        externalOrigin: null,
      },
      ship: { kind: "idle", status: null, loadingStatus: false },
      editorAvailability: { kind: "available" },
      attention: "settled",
      unread: false,
      lifecycle: "settled",
      repositoryLabel: "app",
      projectOrigin: "active-tab",
      worktreeRemoved: false,
      worktreeMissing: false,
      changeSummary: null,
      ...(sessionBackground === undefined ? {} : { sessionBackground }),
    };
    act(() =>
      root.render(
        <PanelHarness>
          <AgentThreadSession
            thread={view}
            composerRepositoryLabel="app"
            onReviewInDiff={() => {}}
            onStopSessionTask={onStopSessionTask}
            sessionTaskControls={
              onStopSessionTask === undefined
                ? null
                : { pendingTaskIds: new Set(), endSession: "offered" }
            }
          />
        </PanelHarness>,
      ),
    );
  }

  const bars = () => host.querySelectorAll(".cv-session-dock__banners .cv-composer-banner");

  it("shows one thread-level bar for a resumed agent after its turn settled and never re-opens the turn", () => {
    render(resumedAgent);
    expect(bars()).toHaveLength(1);
    expect(bars()[0]?.querySelector(".cv-banner-line")?.textContent).toBe("1 agent running");
    expect(host.querySelector('button[aria-label="Stop agent and background work"]')).toBeNull();
    expect(host.textContent).toContain("Claude continued after background work finished");
    render(undefined);
    expect(bars()).toHaveLength(0);
  });

  it("shows one announced bar while Claude writes a follow-up reply, with nothing to view, stop or end", () => {
    render(replyOnly);
    expect(bars()).toHaveLength(1);
    expect(bars()[0]?.querySelector(".cv-banner-line")?.textContent).toBe("Claude is replying");
    expect(bars()[0]?.querySelectorAll("button")).toHaveLength(0);
    expect(host.querySelector('button[aria-label="View background tasks"]')).toBeNull();
    expect(host.querySelector('button[aria-label="View agents"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Stop agent and background work"]')).toBeNull();
    expect(host.querySelector('button[aria-label="End Claude session"]')).toBeNull();
    expect(host.querySelector('.cv-session-dock__banners [aria-live="polite"]')).not.toBeNull();
    render({
      ...replyOnly,
      reply: { kind: "expected", sinceEpochMs: RESUMED_AT, untilEpochMs: RESUMED_AT + 5_000 },
    });
    expect(bars()).toHaveLength(1);
    expect(bars()[0]?.querySelector(".cv-banner-line")?.textContent).toBe("Claude is replying");
    expect(bars()[0]?.querySelectorAll("button")).toHaveLength(0);
    render({ ...resumedAgent, reply: replyOnly.reply });
    expect(bars()).toHaveLength(1);
    expect(bars()[0]?.querySelector(".cv-banner-line")?.textContent).toBe(
      "Replying · 1 agent running",
    );
    expect(host.querySelector('button[aria-label="View agents"]')).not.toBeNull();
    render(undefined);
    expect(bars()).toHaveLength(0);
  });

  const rightPanelRows = () =>
    host.querySelectorAll(
      '[data-testid="right-panel"] .cv-agents__section[data-section="running"] .cv-agents-row',
    );

  it("opens the Agents panel on View with the resumed agent and its own Stop", () => {
    const stopTask = vi.fn();
    render(resumedAgent, stopTask);
    expect(host.querySelector('[data-testid="right-panel"]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="View agents"]')?.click());
    expect(rightPanelRows()).toHaveLength(1);
    expect(rightPanelRows()[0]?.querySelector(".cv-agents-row__name")?.textContent).toBe(
      "Live Codex model catalog like Claude",
    );
    expect(host.querySelectorAll('[data-testid="right-panel"] .cv-agents-row')).toHaveLength(1);
    const stop = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop background task \\"Live Codex model catalog like Claude\\""]',
    );
    act(() => stop?.click());
    expect(stopTask).toHaveBeenCalledExactlyOnceWith("agt-mue1wenj-7ede", "a4b355dcf6056a875");
  });

  it("says why a row cannot stop on its own when Codevo has no per-task stop", () => {
    render(resumedAgent);
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="View agents"]')?.click());
    expect(rightPanelRows()[0]?.querySelector(".cv-agents-row__stop")).toBeNull();
    const note = host.querySelector('[data-testid="right-panel"] .cv-agents__running-note');
    expect(note?.textContent).toBe(agentRunningStopReasonText("unavailable"));
    expect(rightPanelRows()[0]?.closest("li")?.getAttribute("aria-describedby")).toBe(note?.id);
  });
});
