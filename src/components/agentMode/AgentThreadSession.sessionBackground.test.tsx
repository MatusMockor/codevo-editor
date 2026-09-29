// @vitest-environment jsdom
import { act, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentAgentsPanelProvider } from "./agents/agentAgentsPanelContext";
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
};

function PanelHarness({ children }: { readonly children: ReactNode }) {
  const [, setOpen] = useState(false);
  const onOpen = useCallback(() => setOpen(true), []);
  const onToggle = useCallback(() => setOpen((current) => !current), []);
  return (
    <AgentAgentsPanelProvider isOpen={false} onOpen={onOpen} onToggle={onToggle}>
      {children}
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

  function render(sessionBackground: AgentSessionBackground | undefined) {
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
          />
        </PanelHarness>,
      ),
    );
  }

  const bars = () => host.querySelectorAll(".cv-session-dock__banners .cv-composer-banner");

  it("shows one thread-level bar for a resumed agent after its turn settled and never re-opens the turn", () => {
    render(resumedAgent);
    expect(bars()).toHaveLength(1);
    expect(bars()[0]?.textContent).toBe("1 agent runningLive Codex model catalog like Claude");
    expect(host.querySelector('button[aria-label="Stop agent and background work"]')).toBeNull();
    expect(host.textContent).toContain("Claude continued after background work finished");
    render(undefined);
    expect(bars()).toHaveLength(0);
  });
});
