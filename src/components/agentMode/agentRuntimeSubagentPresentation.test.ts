import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createAgentOutputParserState,
  feedAgentOutput,
} from "../../domain/agentOutput/agentOutputParser";
import { summarizeAgentRuntimeSubagents } from "../../domain/agentRuntimeSubagent";
import { retainAgentSubagentLifecycle } from "../../domain/agentSubagentLifecycle";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import {
  agentElapsedLabel,
  agentRuntimeSubagentBody,
  agentRuntimeSubagentMemberLabel,
  agentRuntimeSubagentMetricsLabel,
  agentSpawnLeadLabel,
  agentSpawnStatusLabel,
  agentTokenCountLabel,
  agentTurnRuntimeSubagents,
} from "./agentRuntimeSubagentPresentation";

const RUNNING: AgentTurnStatus = { kind: "running" };
const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const STOPPED: AgentTurnStatus = { kind: "stopped" };

function parse(
  kind: AgentCliKind,
  lines: ReadonlyArray<unknown>,
  transport: "exec" | "appServer" = "exec",
): AgentTurnEvent[] {
  let state = createAgentOutputParserState(kind, transport);
  const events: AgentTurnEvent[] = [];
  for (const line of lines) {
    const text = typeof line === "string" ? line : JSON.stringify(line);
    const next = feedAgentOutput(state, "stdout", `${text}\n`);
    state = next.state;
    events.push(...next.events);
  }
  return events;
}

function model(events: ReadonlyArray<AgentTurnEvent>, status: AgentTurnStatus = RUNNING) {
  return agentTurnRuntimeSubagents({
    events,
    status,
    subagentLifecycle: retainAgentSubagentLifecycle(undefined, events),
  });
}

function spawn(id: string, description: string, type = "general-purpose") {
  return {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id,
          name: "Agent",
          input: { description, subagent_type: type, prompt: `Do ${description}` },
        },
      ],
    },
  };
}

function started(toolId: string, taskId: string, description: string) {
  return {
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: toolId,
    task_type: "local_agent",
    subagent_type: "general-purpose",
    description,
  };
}

function progress(ids: { toolId?: string; taskId: string }, description: string, tool: string) {
  return {
    type: "system",
    subtype: "task_progress",
    task_id: ids.taskId,
    ...(ids.toolId === undefined ? {} : { tool_use_id: ids.toolId }),
    subagent_type: "general-purpose",
    description,
    last_tool_name: tool,
    usage: { total_tokens: 61_200, tool_uses: 18, duration_ms: 192_000 },
  };
}

function notification(taskId: string, status: string, toolId?: string) {
  return {
    type: "system",
    subtype: "task_notification",
    task_id: taskId,
    ...(toolId === undefined ? {} : { tool_use_id: toolId }),
    status,
    usage: { total_tokens: 137_000, tool_uses: 35, duration_ms: 654_000 },
  };
}

function toolResult(toolId: string, content: string, isError = false) {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: toolId, content, is_error: isError }],
    },
  };
}

function assistantText(text: string) {
  return { type: "assistant", message: { content: [{ type: "text", text }] } };
}

const codexChild = (kind: string, id: string, path: string) => ({
  v: 1,
  t: "subagent",
  kind,
  agentThreadId: id,
  agentPath: path,
  clipped: false,
});

describe("agentTurnRuntimeSubagents from Claude stream-json", () => {
  it("titles the recorded fixture agent by its task description, not its type", () => {
    const lines = readFileSync("src/domain/agentOutput/fixtures/claude-subagent-turn.jsonl", "utf8")
      .trim()
      .split("\n");
    const result = model(parse("claudeCode", lines), SETTLED);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      title: "Spustiť echo alpha",
      role: "general-purpose",
      status: "completed",
      toolUses: 1,
    });
    expect(result.agents[0]?.elapsed.kind).toBe("settled");
    expect(result.agents[0]?.totalTokens).toBeGreaterThan(0);
    expect(result.batches).toHaveLength(1);
  });

  it("keeps parallel agents in one spawn batch in stable spawn order with live progress", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "Stream A Rust backend"),
      spawn("tool-b", "Stream B gateway"),
      started("tool-a", "task-a", "Stream A Rust backend"),
      started("tool-b", "task-b", "Stream B gateway"),
      progress({ toolId: "tool-b", taskId: "task-b" }, "Running npx vitest run", "Bash"),
      progress({ toolId: "tool-a", taskId: "task-a" }, "Reading hosts.rs", "Read"),
    ]);
    const result = model(events);

    expect(result.agents.map((agent) => agent.title)).toEqual([
      "Stream A Rust backend",
      "Stream B gateway",
    ]);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.id).toBe("spawn:tool-a");
    expect(result.agents[1]).toMatchObject({
      status: "working",
      activity: "Running npx vitest run",
      totalTokens: 61_200,
      toolUses: 18,
      elapsed: { kind: "live", observedDurationMs: 192_000 },
    });
    expect(result.agents[0]?.activityOrder).toBeGreaterThan(result.agents[1]?.activityOrder ?? 0);
  });

  it("resolves task-only ticks through the lifecycle alias instead of adding an agent", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "Audit retention"),
      started("tool-a", "task-a", "Audit retention"),
      progress({ taskId: "task-a" }, "Reading agentThread.ts", "Read"),
    ]);
    const result = model(events);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      id: "tool:tool-a",
      title: "Audit retention",
      activity: "Reading agentThread.ts",
    });
  });

  it("falls back to the last tool when a live agent reports no progress text", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "Audit retention"),
      started("tool-a", "task-a", "Audit retention"),
      {
        type: "system",
        subtype: "task_progress",
        task_id: "task-a",
        tool_use_id: "tool-a",
        last_tool_name: "Grep",
        usage: { total_tokens: 10, tool_uses: 1, duration_ms: 5 },
      },
    ]);

    expect(model(events).agents[0]?.activity).toBe("▸ Grep");
  });

  it("separates spawns that root prose splits into their own batches", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "First"),
      toolResult("tool-a", "first done"),
      assistantText("First agent finished, starting the next one."),
      spawn("tool-b", "Second"),
    ]);
    const result = model(events);

    expect(result.batches.map((batch) => batch.id)).toEqual(["spawn:tool-a", "spawn:tool-b"]);
    expect(result.agents[0]).toMatchObject({ status: "completed", activity: "first done" });
  });

  it("folds three async spawns with interleaved launch results into one batch", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "Stream A"),
      toolResult("tool-a", "Async agent launched successfully."),
      started("tool-a", "task-a", "Stream A"),
      spawn("tool-b", "Stream B"),
      toolResult("tool-b", "Async agent launched successfully."),
      started("tool-b", "task-b", "Stream B"),
      spawn("tool-c", "Stream C"),
      toolResult("tool-c", "Async agent launched successfully."),
      started("tool-c", "task-c", "Stream C"),
      progress({ toolId: "tool-b", taskId: "task-b" }, "Reading gateway.ts", "Read"),
    ]);
    const result = model(events);

    expect(result.batches.map((batch) => batch.id)).toEqual(["spawn:tool-a"]);
    expect(result.batches[0]?.agents.map((agent) => agent.title)).toEqual([
      "Stream A",
      "Stream B",
      "Stream C",
    ]);
    expect(result.agents.map((agent) => agent.status)).toEqual(["working", "working", "working"]);
    expect(agentSpawnLeadLabel(summarizeAgentRuntimeSubagents(result.agents), "spawn")).toBe(
      "Kicked off 3 subagents",
    );
  });

  it("separates sequential foreground subagents that return their final reports", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "First"),
      started("tool-a", "task-a", "First"),
      progress({ toolId: "tool-a", taskId: "task-a" }, "Reading a.ts", "Read"),
      notification("task-a", "completed", "tool-a"),
      toolResult("tool-a", "First report"),
      spawn("tool-b", "Second"),
      started("tool-b", "task-b", "Second"),
      notification("task-b", "completed", "tool-b"),
      toolResult("tool-b", "Second report"),
    ]);
    const result = model(events, SETTLED);

    expect(result.batches.map((batch) => batch.id)).toEqual(["spawn:tool-a", "spawn:tool-b"]);
    expect(result.batches.map((batch) => batch.agents.length)).toEqual([1, 1]);
  });

  it("keeps the batch and its members stable from live to settled", () => {
    const live = [
      spawn("tool-a", "Stream A"),
      toolResult("tool-a", "Async agent launched successfully."),
      started("tool-a", "task-a", "Stream A"),
      spawn("tool-b", "Stream B"),
      toolResult("tool-b", "Async agent launched successfully."),
      started("tool-b", "task-b", "Stream B"),
    ];
    const settled = [
      ...live,
      notification("task-a", "completed", "tool-a"),
      notification("task-b", "failed", "tool-b"),
    ];
    const running = model(parse("claudeCode", live));
    const done = model(parse("claudeCode", settled), SETTLED);
    const summary = summarizeAgentRuntimeSubagents(done.agents);

    expect(running.batches.map((batch) => batch.id)).toEqual(["spawn:tool-a"]);
    expect(done.batches.map((batch) => batch.id)).toEqual(["spawn:tool-a"]);
    expect(done.agents.map((agent) => agent.id)).toEqual(running.agents.map((agent) => agent.id));
    expect(done.agents.map((agent) => agent.status)).toEqual(["completed", "failed"]);
    expect(agentSpawnLeadLabel(summary, "spawn")).toBe("Ran 2 subagents");
    expect(agentSpawnStatusLabel(summary)).toBe("1 failed");
  });

  it("keeps a bounded recent activity history per agent with oldest-first eviction", () => {
    const steps = Array.from({ length: 9 }, (_, index) =>
      progress({ toolId: "tool-a", taskId: "task-a" }, `Step ${index}`, "Read"),
    );
    const events = parse("claudeCode", [
      spawn("tool-a", "Stream A"),
      started("tool-a", "task-a", "Stream A"),
      progress({ toolId: "tool-a", taskId: "task-a" }, "Step 0", "Read"),
      ...steps,
    ]);
    const agent = model(events).agents[0];

    expect(agent?.recentActivity).toEqual([
      "Step 3",
      "Step 4",
      "Step 5",
      "Step 6",
      "Step 7",
      "Step 8",
    ]);
  });

  it("records the last tool when a progress tick carries no description", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "Stream A"),
      started("tool-a", "task-a", "Stream A"),
      progress({ toolId: "tool-a", taskId: "task-a" }, "Reading a.ts", "Read"),
      {
        type: "system",
        subtype: "task_progress",
        task_id: "task-a",
        tool_use_id: "tool-a",
        last_tool_name: "Grep",
        usage: { total_tokens: 10, tool_uses: 2, duration_ms: 5 },
      },
    ]);

    expect(model(events).agents[0]?.recentActivity).toEqual(["Reading a.ts", "▸ Grep"]);
  });

  it("reports failed and stopped agents with their error as the activity", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "Breaks"),
      spawn("tool-b", "Gets stopped"),
      started("tool-a", "task-a", "Breaks"),
      started("tool-b", "task-b", "Gets stopped"),
      toolResult("tool-a", "cargo test failed", true),
      notification("task-a", "failed", "tool-a"),
      notification("task-b", "killed"),
    ]);
    const result = model(events);

    expect(result.agents[0]).toMatchObject({ status: "failed", activity: "cargo test failed" });
    expect(result.agents[1]?.status).toBe("stopped");
    const summary = summarizeAgentRuntimeSubagents(result.agents);
    expect(agentSpawnStatusLabel(summary)).toBe("1 failed");
    expect(summary.tone).toBe("failed");
  });

  it("does not resurrect a terminal agent when its ids are reused by a late tick", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "Finishes"),
      started("tool-a", "task-a", "Finishes"),
      notification("task-a", "completed", "tool-a"),
      progress({ toolId: "tool-a", taskId: "task-a" }, "Late tick", "Bash"),
    ]);
    const result = model(events);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.status).toBe("completed");
  });

  it("never claims completion for agents whose status is unknown after the turn settles", () => {
    const events = parse("claudeCode", [spawn("tool-a", "Vanishes")]);
    const settled = model(events, SETTLED);
    const stopped = model(events, STOPPED);

    expect(settled.agents[0]?.status).toBe("unknown");
    expect(agentSpawnStatusLabel(summarizeAgentRuntimeSubagents(settled.agents))).toBe(
      "status unavailable",
    );
    expect(stopped.agents[0]?.status).toBe("stopped");
    expect(agentSpawnStatusLabel(summarizeAgentRuntimeSubagents(stopped.agents))).toBe("stopped");
  });

  it("bounds the agent list truthfully", () => {
    const lines = Array.from({ length: 40 }, (_, index) => spawn(`tool-${index}`, `Job ${index}`));
    const result = model(parse("claudeCode", lines));
    const summary = summarizeAgentRuntimeSubagents(result.agents);

    expect(result.agents).toHaveLength(32);
    expect(result.truncated).toBe(true);
    expect(agentSpawnLeadLabel(summary, "spawn")).toBe("Kicked off 32 subagents");
    expect(agentSpawnStatusLabel(summary)).toBe("32 working");
  });
});

describe("agentTurnRuntimeSubagents from the Codex app-server", () => {
  it("maps the Rust golden child thread into the same model", () => {
    const lines = readFileSync(
      "src-tauri/tests/fixtures/codex_app_server/session-subagent.events.jsonl",
      "utf8",
    )
      .trim()
      .split("\n");
    const result = model(parse("codex", lines, "appServer"), SETTLED);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      title: "echo_test",
      role: null,
      status: "completed",
      activity: "from-subagent",
      elapsed: { kind: "settled", durationMs: 9966 },
      totalTokens: 18_492,
      batchId: "turn",
    });
  });

  it("shows live child tool activity, idle resumable children and interrupted children", () => {
    const events = parse(
      "codex",
      [
        codexChild("started", "child-a", "/root/explorer"),
        codexChild("started", "child-b", "/root/reviewer"),
        codexChild("started", "child-c", "/root/tester"),
        {
          v: 1,
          t: "subagentItem",
          agentThreadId: "child-a",
          inner: {
            t: "toolCall",
            toolId: "exec-1",
            name: "shell",
            inputSummary: "rg subagent",
            clipped: false,
          },
        },
        {
          v: 1,
          t: "subagentTurnCompleted",
          agentThreadId: "child-b",
          durationMs: 4200,
          isError: false,
        },
        codexChild("interrupted", "child-c", "/root/tester"),
      ],
      "appServer",
    );
    const result = model(events);

    expect(result.agents.map((agent) => [agent.title, agent.status])).toEqual([
      ["explorer", "working"],
      ["reviewer", "idle"],
      ["tester", "stopped"],
    ]);
    expect(result.agents[0]).toMatchObject({
      activity: "rg subagent",
      elapsed: { kind: "unknown" },
    });
    expect(model(events, SETTLED).agents[1]?.status).toBe("completed");
  });
});

describe("runtime subagent labels", () => {
  it("formats tokens, elapsed time and summaries", () => {
    expect(agentTokenCountLabel(999)).toBe("999");
    expect(agentTokenCountLabel(61_200)).toBe("61.2k");
    expect(agentTokenCountLabel(2_500_000)).toBe("2.5M");
    expect(agentElapsedLabel(9_000)).toBe("9s");
    expect(agentElapsedLabel(192_000)).toBe("3m 12s");
    expect(agentElapsedLabel(3_720_000)).toBe("1h 02m");
  });

  it("labels settled members with metrics and keeps non-success outcomes explicit", () => {
    const events = parse("claudeCode", [
      spawn("tool-a", "Finishes"),
      started("tool-a", "task-a", "Finishes"),
      notification("task-a", "completed", "tool-a"),
    ]);
    const agent = model(events, SETTLED).agents[0];
    expect(agent).toBeDefined();
    if (agent === undefined) return;

    expect(agentRuntimeSubagentMemberLabel(agent)).toBe("10m 54s · 137.0k tok");
    expect(agentRuntimeSubagentMetricsLabel(agent)).toBe("137.0k tok · 35 tools");
    expect(agentRuntimeSubagentMemberLabel({ ...agent, status: "failed" })).toBe(
      "Failed · 10m 54s · 137.0k tok",
    );
    expect(agentRuntimeSubagentBody({ ...agent, activity: null, model: null })).toBeNull();
    expect(agentRuntimeSubagentBody({ ...agent, activity: "done", model: "opus-5" })).toBe(
      "done\n\nopus-5",
    );
  });
});
