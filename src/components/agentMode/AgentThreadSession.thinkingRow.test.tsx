// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import { AgentThreadSession } from "./AgentThreadSession";

const THOUGHT =
  "This is a complex task—I need to investigate how the Claude model catalog is implemented, including the provider, Rust manifest, and validation, then figure out Codex's equivalent source of truth, whether that's an RPC call or a cached models file.\n\n";

const FIRST_THIRTEEN_SECONDS: ReadonlyArray<AgentTurnEvent> = [
  {
    kind: "unknownLine",
    stream: "stdout",
    raw: "Unsupported Claude stream frame: command_lifecycle",
    clipped: false,
  },
  { kind: "reasoning", text: THOUGHT },
  {
    kind: "contextUsage",
    observedAtEpochMs: 1_790_716_549_728,
    model: "claude-opus-5-5",
    inputTokens: 561_824,
    contextWindow: null,
  },
];

const SETTLED_TAIL: ReadonlyArray<AgentTurnEvent> = [
  { kind: "assistantText", text: "Mapped the catalog." },
  {
    kind: "result",
    text: "Mapped the catalog.",
    isError: false,
    usage: { inputTokens: 561_824, outputTokens: 40, contextTokens: null },
  },
];

describe("one thought row per thinking phase", () => {
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

  it("shows a single Thinking row while the live turn's latest item is a thought", () => {
    render(FIRST_THIRTEEN_SECONDS, { kind: "running" });

    expect(workRowsSaying("Thinking")).toHaveLength(1);
    const toggle = host.querySelector<HTMLButtonElement>(".agent-activity-group__toggle");
    expect(toggle?.querySelector(".agent-activity-group__label")?.textContent).toBe("Thinking");
    expect(host.querySelector(".cv-live-row")).toBeNull();

    act(() => toggle?.click());

    expect(host.querySelector(".agent-thought__body")?.textContent).toContain(
      "Claude model catalog",
    );
  });

  it("merges consecutive thoughts into one Thinking row that expands to all of them", () => {
    render(
      [
        ...FIRST_THIRTEEN_SECONDS,
        { kind: "reasoning", text: "" },
        { kind: "reasoning", text: "Start with the Claude catalog code." },
      ],
      { kind: "running" },
    );

    expect(workRowsSaying("Thinking")).toHaveLength(1);
    expect(host.querySelectorAll(".agent-activity-group")).toHaveLength(1);

    act(() => host.querySelector<HTMLButtonElement>(".agent-activity-group__toggle")?.click());

    const bodies = [...host.querySelectorAll(".agent-thought__body")].map(
      (body) => body.textContent ?? "",
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("Claude model catalog");
    expect(bodies[1]).toContain("Start with the Claude catalog code.");
  });

  it("keeps the live Working row while a tool runs after the thought", () => {
    render(
      [
        ...FIRST_THIRTEEN_SECONDS,
        { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "git status --short" },
      ],
      { kind: "running" },
    );

    expect(workRowsSaying("Thinking")).toHaveLength(0);
    expect(host.querySelectorAll(".cv-live-row")).toHaveLength(1);
  });

  it("shows a single Thinking row when a follow-up message lands in the thinking turn", () => {
    render(
      [
        ...FIRST_THIRTEEN_SECONDS,
        { kind: "userMessage", text: "a pozri aj Codex" },
        { kind: "reasoning", text: "The follow-up widens the scope to Codex." },
      ],
      { kind: "running" },
    );

    expect(workRowsSaying("Thinking")).toHaveLength(1);
    expect(host.querySelector(".cv-live-row")).toBeNull();
  });

  it("keeps the live Working row after a follow-up message that has no thought yet", () => {
    render([...FIRST_THIRTEEN_SECONDS, { kind: "userMessage", text: "a pozri aj Codex" }], {
      kind: "running",
    });

    expect(workRowsSaying("Thinking")).toHaveLength(0);
    expect(workRowsSaying("Working…")).toHaveLength(1);
  });

  it("drops the live row and says Thought once the turn settles", () => {
    render([...FIRST_THIRTEEN_SECONDS, ...SETTLED_TAIL], { kind: "exited", exitCode: 0 });

    expect(workRowsSaying("Thinking")).toHaveLength(0);
    expect(host.querySelector(".cv-live-row")).toBeNull();
    expect(
      host.querySelector(".agent-activity-group__toggle .agent-activity-group__label")?.textContent,
    ).toBe("Thought");
  });

  function workRowsSaying(text: string): ReadonlyArray<Element> {
    return [...host.querySelectorAll(".cv-work-row, .cv-live-row")].filter((row) =>
      [...row.querySelectorAll(".agent-activity-group__label, .cv-live-row__label")].some(
        (label) => label.textContent === text,
      ),
    );
  }

  function render(events: ReadonlyArray<AgentTurnEvent>, status: AgentTurnStatus) {
    const startedAtEpochMs = Date.now() - 13_000;
    const turn: AgentTurn = {
      turnId: "turn",
      prompt: "chcem to mat tak ako su aj claude code modeli",
      status,
      events,
      startedAtEpochMs,
      endedAtEpochMs: status.kind === "running" ? null : startedAtEpochMs + 13_000,
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
        title: "Codex catalog",
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
      attention: status.kind === "running" ? "running" : "settled",
      unread: false,
      lifecycle: status.kind === "running" ? "running" : "settled",
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
