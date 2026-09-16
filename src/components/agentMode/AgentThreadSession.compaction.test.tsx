// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import type { AgentCliKind } from "../../domain/agentTask";
import { AgentThreadSession } from "./AgentThreadSession";

const started: AgentTurnEvent = {
  kind: "contextCompactionStatus",
  status: "compacting",
  message: null,
};
const completed: AgentTurnEvent = {
  kind: "contextCompaction",
  beforeTokens: 100,
  afterTokens: null,
};

describe("thread compaction visibility", () => {
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
    events: readonly AgentTurnEvent[],
    status: AgentTurnStatus = { kind: "running" },
    prompt = "/compact",
    provider: AgentCliKind = "claudeCode",
  ) {
    const turn: AgentTurn = {
      turnId: "turn",
      prompt,
      status,
      events,
      startedAtEpochMs: Date.now() - 32000,
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
        provider: { kind: provider, sessionId: "session" },
        title: "Compact",
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
  it("shows manual pending activity in the existing answer, not generic waiting", () => {
    render([], { kind: "pending" });
    expect(host.querySelector('.agent-answer [role="status"]')?.textContent).toBe(
      "Compacting context…",
    );
    expect(host.textContent).not.toContain("Waiting for output");
    expect(host.textContent).not.toContain("Conversation compacted");
  });
  it("suppresses normal live Working after previous output and resumes after idle", () => {
    const tool: AgentTurnEvent = {
      kind: "toolCall",
      name: "Read",
      inputSummary: "file.ts",
      toolId: "read",
    };
    render([tool, started], { kind: "running" }, "Inspect code");
    expect(host.textContent).toContain("Compacting context…");
    expect(host.textContent).not.toContain("Working");
    expect(host.textContent).toContain("Turn elapsed");
    render(
      [tool, started, { kind: "contextCompactionStatus", status: "idle", message: null }],
      { kind: "running" },
      "Inspect code",
    );
    expect(host.textContent).not.toContain("Compacting context…");
    expect(host.textContent).not.toContain("Conversation compacted");
  });
  it("shows only explicit completion and can start another compaction", () => {
    render([started, completed]);
    expect(host.textContent).toContain("Conversation compacted");
    expect(host.textContent).not.toContain("Compacting context…");
    expect(host.textContent).not.toContain("→");
    render([started, completed, started]);
    expect(host.textContent).toContain("Compacting context…");
  });
  it.each<AgentTurnStatus>([
    { kind: "stopped" },
    { kind: "interrupted" },
    { kind: "failed", message: "limit" },
  ])("does not invent success after %j", (status) => {
    render([started], status);
    expect(host.textContent).not.toContain("Compacting context…");
    expect(host.textContent).not.toContain("Conversation compacted");
  });
  it("settles provider result without inventing a missing compact boundary", () => {
    render([started, { kind: "result", text: "", isError: false, usage: null }]);
    expect(host.textContent).not.toContain("Compacting context…");
    expect(host.textContent).not.toContain("Conversation compacted");
  });
  it("shows an explicit compact failure even after a successful transport result", () => {
    render(
      [
        started,
        { kind: "contextCompactionStatus", status: "failed", message: "Not enough context" },
        { kind: "result", text: "", isError: false, usage: null },
      ],
      { kind: "exited", exitCode: 0 },
    );
    expect(host.textContent).toContain("Context compaction failed: Not enough context");
    expect(host.textContent).not.toContain("Conversation compacted");
    expect(host.textContent).not.toContain("Compacting context…");
  });
  it("keeps pending Codex startup as a single status", () => {
    render([], { kind: "pending" }, "hello", "codex");
    expect(host.textContent).toContain("Starting Codex…");
    expect(host.textContent).not.toContain("Waiting for output");
  });
});
