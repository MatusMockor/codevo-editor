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
  const claudeAgents: AgentTurnEvent[] = [
    {
      kind: "toolCall",
      toolId: "spawn-a",
      name: "Agent",
      inputSummary: "prompt a",
      description: "Stream A backend",
    },
    {
      kind: "toolCall",
      toolId: "spawn-b",
      name: "Agent",
      inputSummary: "prompt b",
      description: "Stream B gateway",
    },
    { kind: "subagent", status: "starting", toolId: "spawn-a", taskId: "task-a" },
    { kind: "subagent", status: "starting", toolId: "spawn-b", taskId: "task-b" },
    {
      kind: "subagent",
      status: "running",
      taskId: "task-b",
      description: "Running vitest",
      lastToolName: "Bash",
      durationMs: 5000,
    },
    { kind: "assistantText", text: "Lead keeps working." },
    { kind: "toolCall", toolId: "lead-read", name: "Read", inputSummary: "src/app.ts" },
  ];
  const codexAgents: AgentTurnEvent[] = [
    {
      kind: "subagentActivity",
      agentThreadId: "child",
      agentPath: "/root/explorer",
      activity: "started",
    },
    {
      kind: "subagentEvent",
      agentThreadId: "child",
      event: { kind: "toolCall", toolId: "exec", name: "shell", inputSummary: "rg subagent" },
    },
    { kind: "assistantText", text: "Lead keeps working." },
  ];
  const indicator = () => host.querySelector<HTMLButtonElement>(".agent-background-row__action");

  it("shows live agents while the Claude lead is still working and opens the Agents panel", () => {
    render(claudeAgents);
    expect(host.querySelector(".agent-background-row__label")?.textContent).toBe(
      "2 agents working",
    );
    expect(host.querySelector(".agent-background-row__latest")?.textContent).toBe(
      "Stream B gateway \u00B7 Running vitest",
    );
    expect(host.querySelector(".agents-panel")).toBeNull();

    act(() => indicator()?.click());
    const rows = [...host.querySelectorAll(".agents-panel__name")].map((row) => row.textContent);
    expect(rows).toEqual(["Stream A backend", "Stream B gateway"]);

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close Agents panel"]')?.click());
    expect(host.querySelector(".agents-panel")).toBeNull();
  });
  it("shows live agents while the Codex lead is still working", () => {
    render(codexAgents, { kind: "running" }, "Delegate", "codex");
    expect(host.querySelector(".agent-background-row__label")?.textContent).toBe("1 agent working");
    expect(host.querySelector(".agent-background-row__latest")?.textContent).toBe(
      "explorer \u00B7 rg subagent",
    );
    act(() => host.querySelector<HTMLButtonElement>(".agent-spawn__row")?.click());
    act(() => host.querySelector<HTMLButtonElement>(".agent-spawn__open")?.click());
    expect(host.querySelector(".agents-panel__name")?.textContent).toBe("explorer");
  });
  it("hides the agent indicator once the agents or the run settle", () => {
    render(
      [
        ...codexAgents,
        { kind: "subagentTurnDone", agentThreadId: "child", durationMs: 9, isError: false },
      ],
      { kind: "running" },
      "Delegate",
      "codex",
    );
    expect(indicator()).toBeNull();
    render(claudeAgents, { kind: "exited", exitCode: 0 });
    expect(indicator()).toBeNull();
    render(claudeAgents, { kind: "interrupted" });
    expect(indicator()).toBeNull();
  });
  it("keeps live background tasks visible while the foreground is working", () => {
    render([started, work]);
    expect(host.textContent).toContain("1 background task running");
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
