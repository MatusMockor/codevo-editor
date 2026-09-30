import { describe, expect, it } from "vitest";
import { summarizeAgentRuntimeSubagents } from "../../domain/agentRuntimeSubagent";
import type { AgentTurn } from "../../domain/agentThread";
import { agentAgentsPanelModel, agentSubagentAnnouncement } from "./agentAgentsPanelPresentation";
import { agentBackgroundIndicator } from "./agentBackgroundIndicatorPresentation";
import { AGENT_SUBAGENT_UNFOLLOWED_NOTE } from "./agentSubagentDisclosurePresentation";
import { agentRunningLabel, agentRunningWork } from "./agents/agentRunningWork";
import {
  agentRuntimeSubagentActivityLine,
  agentTurnRuntimeSubagents,
} from "./agentRuntimeSubagentPresentation";

const STARTED_AT = 1_790_787_832_000;

const QA_EVENTS: AgentTurn["events"] = [
  {
    kind: "subagentActivity",
    agentThreadId: "01a0f345-d989-77b1-b22d-8784274f404f",
    agentPath: "/root/sleep_agent_1",
    activity: "started",
  },
  { kind: "contextUsage", model: "codex", inputTokens: null, contextWindow: 258_400 },
  {
    kind: "subagentActivity",
    agentThreadId: "01a0f345-e039-7e31-8447-4925d413dc35",
    agentPath: "/root/sleep_agent_2",
    activity: "started",
  },
  { kind: "assistantText", text: "STARTED" },
];

const QA_RESULT: AgentTurn["events"][number] = {
  kind: "result",
  durationMs: 6_673,
  text: "",
  isError: false,
  usage: null,
};

function turn(status: AgentTurn["status"], events: AgentTurn["events"]): AgentTurn {
  return {
    turnId: "agt-muocu63t-32df",
    prompt: "Launch two background subagents that sleep 60, then reply STARTED.",
    status,
    startedAtEpochMs: STARTED_AT,
    endedAtEpochMs: status.kind === "running" ? null : STARTED_AT + 6_673,
    events,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

const INACTIVE = {
  phase: "inactive",
  foregroundSettled: false,
  tasks: [],
  truncated: false,
} as const;

describe("Codex background subagents replayed from the QA thread log", () => {
  it("lists both running subagents with the count copy and Codex's thread-only stop", () => {
    const subagents = agentTurnRuntimeSubagents(turn({ kind: "running" }, QA_EVENTS));
    expect(subagents.agents.map((agent) => [agent.title, agent.status])).toEqual([
      ["sleep_agent_1", "working"],
      ["sleep_agent_2", "working"],
    ]);
    const indicator = agentBackgroundIndicator(INACTIVE, subagents, "codex");
    expect(indicator.kind === "agents" ? indicator.label : null).toBe("2 agents running");
    const work = agentRunningWork({
      provider: "codex",
      groups: [{ key: "agt-muocu63t-32df", subagents }],
      session: null,
      live: null,
      stop: { kind: "unavailable", reason: "unavailable" },
    });
    expect(agentRunningLabel(work)).toBe("2 agents running");
    expect(work.rows.map((row) => [row.kind, row.stop])).toEqual([
      ["subagent", { kind: "unavailable", reason: "codex" }],
      ["subagent", { kind: "unavailable", reason: "codex" }],
    ]);
    expect(
      agentSubagentAnnouncement(
        null,
        summarizeAgentRuntimeSubagents(subagents.agents).counts,
        false,
      ),
    ).toBe("2 agents running");
  });

  it("never claims the subagents finished once Codevo stops following them", () => {
    const settled = agentTurnRuntimeSubagents(
      turn({ kind: "exited", exitCode: 0 }, [...QA_EVENTS, QA_RESULT]),
    );
    expect(settled.agents.map((agent) => agent.status)).toEqual(["unknown", "unknown"]);
    expect(settled.agents.map(agentRuntimeSubagentActivityLine)).toEqual([
      AGENT_SUBAGENT_UNFOLLOWED_NOTE,
      AGENT_SUBAGENT_UNFOLLOWED_NOTE,
    ]);
    const model = agentAgentsPanelModel([{ key: "agt-muocu63t-32df", subagents: settled }]);
    expect([model.working, model.unknown, model.settled]).toEqual([0, 2, 0]);
    expect(
      agentSubagentAnnouncement(2, summarizeAgentRuntimeSubagents(settled.agents).counts, false),
    ).toBe("Status of 2 agents unknown");
    const work = agentRunningWork({
      provider: "codex",
      groups: [{ key: "agt-muocu63t-32df", subagents: settled }],
      session: null,
      live: null,
      stop: { kind: "unavailable", reason: "unavailable" },
    });
    expect(agentRunningLabel(work)).toBeNull();
  });

  it("moves a subagent out of Running once Codex reports its turn done", () => {
    const done = agentTurnRuntimeSubagents(
      turn({ kind: "running" }, [
        ...QA_EVENTS,
        {
          kind: "subagentTurnDone",
          agentThreadId: "01a0f345-d989-77b1-b22d-8784274f404f",
          durationMs: 60_400,
          isError: false,
        },
      ]),
    );
    expect(done.agents.map((agent) => agent.status)).toEqual(["idle", "working"]);
  });
});
