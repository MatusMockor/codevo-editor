// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  createAgentOutputParserState,
  feedAgentOutput,
} from "../../domain/agentOutput/agentOutputParser";
import { AgentThreadSession } from "./AgentThreadSession";

const started: AgentTurnEvent = {
  kind: "backgroundTask",
  taskId: "watch",
  taskType: "monitor",
  status: "starting",
  description: "Watching pipeline 400200",
};
const result: Extract<AgentTurnEvent, { kind: "result" }> = {
  kind: "result",
  text: "I will report the pipeline result.",
  isError: false,
  usage: null,
};
const work: AgentTurnEvent = {
  kind: "toolCall",
  name: "Bash",
  toolId: "shell",
  inputSummary: "Watch pipeline",
};

describe("thread background activity visibility", () => {
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
    prompt = "Watch pipeline",
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
  it("keeps the foreground answer outside the closed work fold while monitoring real work", () => {
    render([work, started, result]);
    expect(host.textContent).toContain("Monitoring");
    expect(host.textContent).toContain("Watching pipeline 400200");
    expect(host.querySelector(".agent-work")?.hasAttribute("open")).toBe(false);
    expect(host.querySelector(".agent-work")?.textContent).not.toContain(result.text);
    expect(host.textContent).toContain(result.text);
    expect(host.textContent).not.toContain("Working for");
    expect(host.textContent).not.toContain("Working…");
  });
  it("renders later native output in the same turn and clears status at completion", async () => {
    render([started, result]);
    expect(host.textContent).toContain("Monitoring");
    render([work, started, result, { kind: "assistantText", text: "Pipeline succeeded." }]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(host.textContent).toContain("Pipeline succeeded.");
    expect(host.textContent).not.toContain("Monitoring");
    render(
      [
        work,
        started,
        result,
        { ...started, status: "completed" },
        { kind: "assistantText", text: "Pipeline succeeded." },
        { kind: "result", text: "Pipeline succeeded.", isError: false, usage: null },
      ],
      { kind: "exited", exitCode: 0 },
    );
    expect(host.querySelectorAll(".agent-turn")).toHaveLength(1);
    expect(host.querySelector(".agent-work")?.textContent ?? "").not.toContain(
      "Pipeline succeeded.",
    );
    expect(host.textContent).not.toContain("Monitoring");
  });
  it("does not resurrect persisted tasks after process interruption or stop", () => {
    render([started, result], { kind: "interrupted" });
    expect(host.textContent).not.toContain("Monitoring");
    render([started, result], { kind: "running" });
    expect(host.textContent).toContain("Monitoring");
    render([started, result, { ...started, status: "stopped" }]);
    expect(host.textContent).not.toContain("Monitoring");
  });
  it("never infers liveness from prose, and leaves Codex presentation unchanged", () => {
    render([result]);
    expect(host.textContent).not.toContain("Monitoring");
    render([started, result], { kind: "running" }, "Watch", "codex");
    expect(host.textContent).not.toContain("Monitoring");
  });
  it("distinguishes real background agent work from monitoring", () => {
    render([{ ...started, taskType: "agent" }, result]);
    expect(host.textContent).toContain("Working in background");
    expect(host.textContent).not.toContain("Monitoring");
  });
  it("projects native streamed task lifecycle through reconnect and terminal process exit", async () => {
    let parser = createAgentOutputParserState("claudeCode");
    const events: AgentTurnEvent[] = [];
    const feed = (value: unknown) => {
      const next = feedAgentOutput(parser, "stdout", `${JSON.stringify(value)}\n`);
      parser = next.state;
      events.push(...next.events);
      render([...events]);
    };
    feed({
      type: "system",
      subtype: "task_started",
      task_id: "watch",
      task_type: "monitor",
      description: "Watching pipeline 400200",
    });
    feed({
      type: "result",
      subtype: "success",
      result: "I will report the pipeline result.",
      is_error: false,
    });
    expect(host.textContent).toContain("Monitoring");
    render([...events]); // a reconnect snapshot of the same live run
    expect(host.textContent).toContain("Monitoring");
    feed({ type: "system", subtype: "task_notification", task_id: "watch", status: "completed" });
    feed({
      type: "assistant",
      message: { content: [{ type: "text", text: "Pipeline completed successfully." }] },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(host.textContent).toContain("Pipeline completed successfully.");
    expect(host.textContent).not.toContain("Monitoring");
    render([...events], { kind: "exited", exitCode: 0 });
    expect(host.querySelectorAll(".agent-turn")).toHaveLength(1);
    expect(host.textContent).not.toContain("Working…");
  });
});
