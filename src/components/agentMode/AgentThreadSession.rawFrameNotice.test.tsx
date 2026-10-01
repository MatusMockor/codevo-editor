// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import { AgentThreadSession } from "./AgentThreadSession";

const LIFECYCLE_NOTICE = "Unsupported Claude stream frame: command_lifecycle";

function stdoutLine(raw: string): AgentTurnEvent {
  return { kind: "unknownLine", stream: "stdout", raw, clipped: false };
}

const QUIT_MID_TURN_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  stdoutLine(LIFECYCLE_NOTICE),
  { kind: "reasoning", text: "Reading the router before changing it." },
  {
    kind: "contextUsage",
    model: "claude-opus-5-5",
    inputTokens: 96_853,
    contextWindow: null,
  },
  { kind: "toolCall", toolId: "toolu_quit", name: "Bash", inputSummary: "npm test" },
];

describe("raw output of Claude stream frame notices", () => {
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

  it.each([
    { name: "interrupted by an app quit", status: { kind: "interrupted" } as const },
    { name: "failed", status: { kind: "failed", message: "Claude Code crashed" } as const },
    { name: "exited non-zero", status: { kind: "exited", exitCode: 1 } as const },
  ])("hides informational frame notices of a $name turn", ({ status }) => {
    render(
      [
        ...QUIT_MID_TURN_EVENTS,
        stdoutLine("Unsupported Claude stream frame: brand_new_frame"),
        stdoutLine("Further unsupported Claude stream frame types omitted for this turn"),
      ],
      status,
    );

    expect(host.querySelector("details.agent-raw")).toBeNull();
    expect(host.textContent).not.toContain("Raw output");
    expect(host.textContent).not.toContain("Unsupported Claude stream frame");
  });

  it("keeps a restored interrupted turn marked as interrupted", () => {
    render(QUIT_MID_TURN_EVENTS, { kind: "interrupted" });

    expect(host.querySelector(".agent-turn-end")?.textContent).toContain("Interrupted");
  });

  it("still discloses malformed frames and other raw output next to a hidden notice", () => {
    render(
      [
        ...QUIT_MID_TURN_EVENTS,
        stdoutLine("Malformed Claude stream frame: command_lifecycle"),
        stdoutLine("Unsupported Claude stream frame: <missing type>"),
        { kind: "unknownLine", stream: "stderr", raw: "npm warn deprecated", clipped: false },
      ],
      { kind: "interrupted" },
    );

    const raw = host.querySelector<HTMLDetailsElement>("details.agent-raw");
    expect(raw?.open).toBe(true);
    expect(raw?.textContent).toContain("Malformed Claude stream frame: command_lifecycle");
    expect(raw?.textContent).toContain("Unsupported Claude stream frame: <missing type>");
    expect(raw?.textContent).toContain("npm warn deprecated");
    expect(raw?.textContent).not.toContain(LIFECYCLE_NOTICE);
  });

  function render(events: ReadonlyArray<AgentTurnEvent>, status: AgentTurnStatus) {
    const turn: AgentTurn = {
      turnId: "turn",
      prompt: "Fix the router",
      status,
      events,
      startedAtEpochMs: Date.now() - 32_000,
      endedAtEpochMs: null,
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
    };
    const view: AgentThreadView = {
      thread: {
        threadId: "thread",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: "claudeCode", sessionId: "session" },
        title: "Router",
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
      attention: "settled",
      unread: false,
      lifecycle: "settled",
      repositoryLabel: "app",
      projectOrigin: "active-tab",
      worktreeRemoved: false,
      worktreeMissing: false,
      changeSummary: null,
    };
    act(() =>
      root.render(
        <AgentThreadSession
          thread={view}
          composerRepositoryLabel="app"
          onReviewInDiff={() => {}}
        />,
      ),
    );
  }
});
