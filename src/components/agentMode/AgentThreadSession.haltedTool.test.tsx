// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import { AgentThreadSession } from "./AgentThreadSession";

const LOOP = "for i in $(seq 1 40); do echo $i; sleep 2; done";
const REJECTION =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const LOOP_TOOL_ID = "toolu_01J6nX3ohxjobMPCNijGhRgY";
const CONTEXT_USAGE: AgentTurnEvent = {
  kind: "contextUsage",
  model: "claude-haiku-4-5",
  inputTokens: 12_000,
  contextWindow: 200_000,
};

const INTERRUPTED_LOOP_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  {
    kind: "unknownLine",
    stream: "stdout",
    raw: "Unsupported Claude stream frame: command_lifecycle",
    clipped: false,
  },
  { kind: "assistantText", text: "Načítavam a spúšťam príkaz v Bash..." },
  CONTEXT_USAGE,
  {
    kind: "toolCall",
    toolId: LOOP_TOOL_ID,
    name: "Bash",
    inputSummary: LOOP,
    description: "Spustiť slučku počítajúcu 1 až 40 s 2-sekundovým čakaním medzi položkami",
  },
  {
    kind: "backgroundTask",
    taskId: "b6p3792o9",
    status: "starting",
    taskType: "shell",
    description: "Spustiť slučku...",
  },
  { kind: "backgroundTask", taskId: "b6p3792o9", status: "stopped", taskType: "other" },
  { kind: "toolResult", toolId: LOOP_TOOL_ID, outputSummary: REJECTION, isError: true },
  {
    kind: "result",
    text: "",
    isError: true,
    usage: { inputTokens: 12_000, outputTokens: 40, contextTokens: null },
  },
  CONTEXT_USAGE,
];

const GENUINE_FAILURE_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "toolCall", toolId: "toolu_failed", name: "Bash", inputSummary: "npm run missing" },
  {
    kind: "toolResult",
    toolId: "toolu_failed",
    outputSummary: 'Exit code 1\nnpm error Missing script: "missing"',
    isError: true,
  },
];

describe("tool rows of a user-halted turn", () => {
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
    { name: "while the stop is settling", status: { kind: "running" } as const, halt: true },
    { name: "after the stop settled", status: { kind: "stopped" } as const, halt: true },
    { name: "after a restored stop", status: { kind: "stopped" } as const, halt: false },
  ])("renders the rejected interrupt tool result as stopped $name", ({ status, halt }) => {
    render(INTERRUPTED_LOOP_EVENTS, status, halt);

    const row = loopRow();
    expect(row?.className).toContain("agent-tool-row--stopped");
    expect(row?.className).not.toContain("agent-tool-row--failed");
    expect(row?.textContent).toMatch(/^Stopped /);
    expect(host.querySelector(".agent-tool-row--failed")).toBeNull();
    expect(turnText()).not.toContain("Failed");
    expect(turnText()).not.toContain("need attention");
  });

  it("renders the rejected interrupt tool result as interrupted when the turn was interrupted", () => {
    render(INTERRUPTED_LOOP_EVENTS, { kind: "interrupted" }, false);

    const row = loopRow();
    expect(row?.className).toContain("agent-tool-row--interrupted");
    expect(row?.textContent).toMatch(/^Interrupted /);
    expect(host.querySelector(".agent-tool-row--failed")).toBeNull();
  });

  it.each([
    { name: "rejected", events: INTERRUPTED_LOOP_EVENTS.slice(3, 7) },
    { name: "unresolved", events: INTERRUPTED_LOOP_EVENTS.slice(3, 6) },
  ])("does not ask for attention for the $name stopped tool in the work summary", ({ events }) => {
    render(
      [...events, { kind: "assistantText", text: "Loop stopped." }],
      { kind: "stopped" },
      true,
    );

    const title = host.querySelector(".agent-work__title")?.textContent ?? "";
    expect(title).toContain("1 command");
    expect(title).not.toContain("need attention");
    expect(host.querySelector<HTMLDetailsElement>("details.agent-work")?.open).toBe(false);
  });

  it("still asks for attention for a genuine failure in the work summary of a stopped turn", () => {
    render(
      [...GENUINE_FAILURE_EVENTS, { kind: "assistantText", text: "Loop stopped." }],
      { kind: "stopped" },
      true,
    );

    expect(host.querySelector(".agent-work__title")?.textContent).toContain("1 need attention");
  });

  it.each([
    { name: "running", status: { kind: "running" } as const },
    { name: "exited", status: { kind: "exited", exitCode: 0 } as const },
    { name: "exited non-zero", status: { kind: "exited", exitCode: 1 } as const },
  ])("keeps the same tool error failed on a $name turn without a stop", ({ status }) => {
    render(INTERRUPTED_LOOP_EVENTS, status, false);

    const row = loopRow();
    expect(row?.className).toContain("agent-tool-row--failed");
    expect(row?.querySelector(".cv-work-status__text")?.textContent).toBe("failed");
    expect(row?.textContent).not.toMatch(/^Failed /);
  });

  it("keeps a genuine failure that finished before the stop failed", () => {
    render([...GENUINE_FAILURE_EVENTS, ...INTERRUPTED_LOOP_EVENTS], { kind: "stopped" }, true);

    const failed = [...host.querySelectorAll(".agent-tool-row--failed")];
    expect(failed).toHaveLength(1);
    expect(failed[0]?.textContent).toContain("npm");
    expect(loopRow()?.className).toContain("agent-tool-row--stopped");
  });

  it("keeps an unresolved tool of a hard-stopped turn neutral", () => {
    render(INTERRUPTED_LOOP_EVENTS.slice(0, 6), { kind: "stopped" }, true);

    const row = loopRow();
    expect(row?.className).toContain("agent-tool-row--stopped");
    expect(row?.textContent).toMatch(/^Stopped /);
    expect(host.querySelector(".agent-tool-row--failed")).toBeNull();
    expect(turnText()).not.toContain("need attention");
  });

  function loopRow(): HTMLButtonElement | null {
    const rows = [...host.querySelectorAll<HTMLButtonElement>("button.agent-tool-row")];
    return rows.find((row) => row.textContent?.includes("slučku")) ?? null;
  }

  function turnText(): string {
    return host.querySelector(".agent-turn")?.textContent ?? "";
  }

  function render(
    events: ReadonlyArray<AgentTurnEvent>,
    status: AgentTurnStatus,
    haltRequested: boolean,
  ) {
    const turn: AgentTurn = {
      turnId: "turn",
      prompt: "Run the loop",
      status,
      events,
      startedAtEpochMs: Date.now() - 32_000,
      endedAtEpochMs: null,
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
      ...(haltRequested ? { haltRequested: true } : {}),
    };
    const view: AgentThreadView = {
      thread: {
        threadId: "thread",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: "claudeCode", sessionId: "session" },
        title: "Loop",
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
