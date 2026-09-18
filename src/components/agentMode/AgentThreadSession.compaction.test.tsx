// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  it("uses an accessible compact activity without a redundant provider header", () => {
    render([], { kind: "pending" });
    expect(host.querySelector(".agent-turn__head")).toBeNull();
    expect(host.querySelector('.agent-compaction-activity[role="status"]')).not.toBeNull();
    expect(host.querySelector('.agent-compaction-activity svg[aria-hidden="true"]')).not.toBeNull();
  });
  it("renders a completed standalone command as a boundary with exact token details", () => {
    render([{ kind: "contextCompaction", beforeTokens: 330123, afterTokens: 8123 }], {
      kind: "exited",
      exitCode: 0,
    });
    expect(host.querySelector('.agent-compaction-event[role="separator"]')).not.toBeNull();
    expect(host.querySelector(".agent-turn__head")).toBeNull();
    const details = host.querySelector<HTMLDetailsElement>(".agent-compaction-event__details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("330,123 → 8,123 tokens");
    act(() => details?.querySelector("summary")?.click());
    expect(details?.open).toBe(true);
  });
  it.each<AgentTurnEvent>([
    { kind: "assistantText", text: "Useful output" },
    { kind: "result", text: "Useful output", isError: false, usage: null },
    { kind: "toolCall", name: "Read", inputSummary: "file.ts", toolId: "read" },
    { kind: "error", message: "Provider failed" },
  ])("retains the provider header and output in a mixed compaction turn %j", async (event) => {
    render([event, completed]);
    expect(host.querySelector(".agent-turn__head")).not.toBeNull();
    expect(host.querySelector('.agent-compaction-event[role="separator"]')).not.toBeNull();
    if (event.kind === "assistantText" || event.kind === "result")
      await act(async () => {
        await vi.waitFor(() => expect(host.textContent).toContain("Useful output"));
      });
  });
  it("keeps automatic completion outside collapsed work and before the final response", async () => {
    render(
      [
        { kind: "toolCall", name: "Read", inputSummary: "file.ts", toolId: "read" },
        completed,
        { kind: "assistantText", text: "Finished inspection" },
      ],
      { kind: "exited", exitCode: 0 },
      "Inspect code",
    );
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain("Finished inspection"));
    });
    const fold = host.querySelector<HTMLDetailsElement>("details.agent-work");
    const boundary = host.querySelector(".agent-compaction-event");
    expect(fold).not.toBeNull();
    expect(fold?.open).toBe(false);
    expect(boundary?.closest("details.agent-work")).toBeNull();
    expect(host.textContent?.indexOf("Conversation compacted")).toBeLessThan(
      host.textContent?.indexOf("Finished inspection") ?? -1,
    );
  });
  it("keeps a header for automatic compaction and failed manual compaction", () => {
    render([completed], { kind: "exited", exitCode: 0 }, "Inspect code");
    expect(host.querySelector(".agent-turn__head")).not.toBeNull();
    render([completed], { kind: "failed", message: "Provider failed" });
    expect(host.querySelector(".agent-turn__head")).not.toBeNull();
  });
  it("keeps pending Codex startup as a single status", () => {
    render([], { kind: "pending" }, "hello", "codex");
    expect(host.textContent).toContain("Starting Codex…");
    expect(host.textContent).not.toContain("Waiting for output");
  });
});
