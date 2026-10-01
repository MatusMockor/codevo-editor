import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_BACKGROUND_TURN_PREVIEW_CHARS,
  agentBackgroundTurn,
  agentBackgroundTurnPreview,
  parseAgentBackgroundTurn,
} from "./agentBackgroundTurn";
import type { AgentThread } from "./agentThread";
import {
  AGENT_BACKGROUND_TURN_LABEL,
  AGENT_UNPROMPTED_TURN_LABEL,
  derivedAgentTurnOrigin,
  isAgentBackgroundTurn,
} from "./agentTurnOrigin";
import { aggregateAgentUsage } from "./agentUsage";
import { defaultAgentLaunchOptions } from "./agentLaunch";

const NOW = new Date(2026, 8, 25, 12, 0, 0, 0).getTime();

function jsonl(...lines: ReadonlyArray<Record<string, unknown>>): string {
  return lines.map((line) => `${JSON.stringify(line)}\n`).join("");
}

const TASK_NOTIFICATION = { origin: { kind: "task-notification" } } as const;

function reply(
  text: string,
  costUsd = 0.02,
  resultKeys: Readonly<Record<string, unknown>> = TASK_NOTIFICATION,
): string {
  return jsonl(
    { type: "system", subtype: "init", session_id: "sess-fixture-0001", model: "claude-opus" },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "text", text }] },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
      total_cost_usd: costUsd,
      usage: { input_tokens: 10, output_tokens: 4 },
      ...resultKeys,
    },
  );
}

describe("parseAgentBackgroundTurn", () => {
  it("parses a complete unprompted Claude turn with the stream-json parser", () => {
    const content = parseAgentBackgroundTurn({
      output: reply("background-finished"),
      truncated: false,
      complete: true,
    });

    expect(content.complete).toBe(true);
    expect(content.eventsTruncated).toBe(false);
    expect(content.events).toContainEqual({
      kind: "assistantText",
      text: "background-finished",
    });
    expect(content.events.find((event) => event.kind === "result")).toMatchObject({
      kind: "result",
      text: "background-finished",
      isError: false,
      usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.02 },
    });
    expect(content.receivedUtf8Bytes).toBe(
      new TextEncoder().encode(reply("background-finished")).byteLength,
    );
  });

  it("marks output the supervisor dropped as truncated and never complete", () => {
    const content = parseAgentBackgroundTurn({
      output: reply("partial"),
      truncated: true,
      complete: true,
    });

    expect(content.eventsTruncated).toBe(true);
    expect(content.complete).toBe(false);
  });

  it("keeps every received event of a reply that ended early without a truncation marker", () => {
    const content = parseAgentBackgroundTurn({
      output: reply("cut short"),
      truncated: false,
      complete: false,
    });

    expect(content.eventsTruncated).toBe(false);
    expect(content.complete).toBe(false);
    expect(content.ended).toBe(false);
    expect(content.events).toContainEqual({ kind: "assistantText", text: "cut short" });
  });
});

describe("agentBackgroundTurn", () => {
  it("builds a terminal background turn without a user prompt or launch", () => {
    const content = parseAgentBackgroundTurn({
      output: reply("done"),
      truncated: false,
      complete: true,
    });
    const turn = agentBackgroundTurn("agt-bg-0001", content, NOW);

    expect(turn).toMatchObject({
      turnId: "agt-bg-0001",
      origin: "background",
      prompt: AGENT_BACKGROUND_TURN_LABEL,
      status: { kind: "exited", exitCode: 0 },
      startedAtEpochMs: NOW,
      endedAtEpochMs: NOW,
      eventsTruncated: false,
      launch: null,
      cliVersion: null,
      streamMetrics: { receivedUtf8Bytes: content.receivedUtf8Bytes, complete: true },
    });
    expect(turn.events).toEqual(content.events);
    expect(isAgentBackgroundTurn(turn)).toBe(true);
  });

  it("labels only a task-notification reply as continuing after background work", () => {
    const labelOf = (output: string) =>
      agentBackgroundTurn(
        "agt-bg-0004",
        parseAgentBackgroundTurn({ output, truncated: false, complete: true }),
        NOW,
      ).prompt;
    const subagentResult = jsonl({
      type: "result",
      subtype: "success",
      parent_tool_use_id: "tool-1",
      result: "nested",
      origin: { kind: "task-notification" },
    });

    expect(labelOf(reply("done"))).toBe(AGENT_BACKGROUND_TURN_LABEL);
    expect(labelOf(`${reply("done", 0.02, {})}`)).toBe(AGENT_UNPROMPTED_TURN_LABEL);
    expect(labelOf(reply("done", 0.02, { user_message_uuid: null }))).toBe(
      AGENT_UNPROMPTED_TURN_LABEL,
    );
    expect(labelOf(reply("done", 0.02, { origin: { kind: "scheduled" } }))).toBe(
      AGENT_UNPROMPTED_TURN_LABEL,
    );
    expect(labelOf(reply("done", 0.02, { origin: "task-notification" }))).toBe(
      AGENT_UNPROMPTED_TURN_LABEL,
    );
    expect(labelOf(`${reply("done", 0.02, {})}${subagentResult}`)).toBe(
      AGENT_UNPROMPTED_TURN_LABEL,
    );
    expect(labelOf("not json\n")).toBe(AGENT_UNPROMPTED_TURN_LABEL);
  });

  it("records an incomplete turn as interrupted without claiming lost activity", () => {
    const content = parseAgentBackgroundTurn({
      output: reply("cut"),
      truncated: false,
      complete: false,
    });
    const turn = agentBackgroundTurn("agt-bg-0002", content, NOW);

    expect(turn.status).toEqual({ kind: "interrupted" });
    expect(turn.eventsTruncated).toBe(false);
    expect(turn.streamMetrics?.complete).toBe(false);
  });

  it("counts its result usage and normalized cost but not as a completed turn", () => {
    const content = parseAgentBackgroundTurn({
      output: reply("done", 0.013),
      truncated: false,
      complete: true,
    });
    const turn = agentBackgroundTurn("agt-bg-0003", content, NOW - 1_000);
    const thread: AgentThread = {
      threadId: "agt-1-0a1c",
      owner: { rootKey: "/repo", ownerId: "ws-1", repositoryRoot: "/repo" },
      target: { isolation: "in-place", worktreePath: null },
      provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
      title: "Thread",
      pinned: false,
      archived: false,
      createdAtEpochMs: NOW - 5_000,
      updatedAtEpochMs: NOW - 1_000,
      turns: [turn],
      turnsTruncated: false,
      integration: null,
      viewedAtEpochMs: null,
      externalOrigin: null,
    };

    const usage = aggregateAgentUsage([thread], "today", NOW).providers.claudeCode.total;

    expect(usage.turnsCompleted).toBe(0);
    expect(usage.cliUsage).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      costUsd: 0.013,
      measuredTurns: 1,
    });
  });
});

describe("agentBackgroundTurnPreview", () => {
  it("previews the final reply text on one bounded line", () => {
    const content = parseAgentBackgroundTurn({
      output: reply(`First line\n\n${"word ".repeat(200)}`),
      truncated: false,
      complete: true,
    });
    const preview = agentBackgroundTurnPreview(content.events);

    expect(preview).not.toBeNull();
    expect(preview?.startsWith("First line word word")).toBe(true);
    expect(preview?.includes("\n")).toBe(false);
    expect(Array.from(preview ?? "").length).toBeLessThanOrEqual(
      MAX_AGENT_BACKGROUND_TURN_PREVIEW_CHARS,
    );
    expect(preview?.endsWith("…")).toBe(true);
  });

  it("falls back to the last assistant text and returns null without reply text", () => {
    expect(
      agentBackgroundTurnPreview([
        { kind: "assistantText", text: "working" },
        { kind: "assistantText", text: "nested", parentToolId: "tool-1" },
      ]),
    ).toBe("working");
    expect(agentBackgroundTurnPreview([{ kind: "reasoning", text: "thinking" }])).toBeNull();
  });
});

describe("derivedAgentTurnOrigin", () => {
  it("derives a background origin only from a marker prompt without launch and CLI version", () => {
    const launch = defaultAgentLaunchOptions("claudeCode");
    const shape = { prompt: AGENT_BACKGROUND_TURN_LABEL, launch: null, cliVersion: null };

    expect(derivedAgentTurnOrigin(shape)).toBe("background");
    expect(derivedAgentTurnOrigin({ ...shape, prompt: AGENT_UNPROMPTED_TURN_LABEL })).toBe(
      "background",
    );
    expect(
      derivedAgentTurnOrigin({ ...shape, prompt: AGENT_UNPROMPTED_TURN_LABEL, launch }),
    ).toBeUndefined();
    expect(derivedAgentTurnOrigin({ ...shape, launch })).toBeUndefined();
    expect(derivedAgentTurnOrigin({ ...shape, cliVersion: "2.1.281" })).toBeUndefined();
    expect(derivedAgentTurnOrigin({ ...shape, prompt: "hello" })).toBeUndefined();
    expect(
      derivedAgentTurnOrigin({ ...shape, prompt: `${AGENT_BACKGROUND_TURN_LABEL} ` }),
    ).toBeUndefined();
  });
});
