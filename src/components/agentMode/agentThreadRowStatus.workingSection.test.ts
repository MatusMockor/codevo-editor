import { describe, expect, it } from "vitest";
import {
  agentRowBelongsInWorkingSection,
  agentRowStatusTone,
  type AgentRowStatus,
} from "./agentThreadRowStatus";

const STATUS_BY_KIND: { readonly [Kind in AgentRowStatus["kind"]]: ReadonlyArray<AgentRowStatus> } =
  {
    working: [
      { kind: "working", startedAtEpochMs: 1_000 },
      { kind: "working", startedAtEpochMs: 1_000, activity: "background" },
      { kind: "working", startedAtEpochMs: 1_000, activity: "monitoring" },
    ],
    agents: [
      { kind: "agents", count: 2, lead: "working", startedAtEpochMs: 1_000 },
      { kind: "agents", count: 1, lead: "waiting", startedAtEpochMs: 1_000 },
    ],
    approval: [{ kind: "approval" }],
    input: [{ kind: "input" }],
    failed: [{ kind: "failed" }],
    stopped: [{ kind: "stopped" }],
    done: [{ kind: "done" }],
    none: [{ kind: "none" }],
  };

const ALL_STATUSES = Object.values(STATUS_BY_KIND).flat();

describe("agentRowBelongsInWorkingSection", () => {
  it("takes working, background and monitoring threads", () => {
    for (const status of STATUS_BY_KIND.working) {
      expect(agentRowBelongsInWorkingSection(status)).toBe(true);
    }
  });

  it("takes threads running agents whether the lead works or waits for them", () => {
    for (const status of STATUS_BY_KIND.agents) {
      expect(agentRowBelongsInWorkingSection(status)).toBe(true);
    }
  });

  it("leaves threads that need the user in the active list", () => {
    expect(agentRowBelongsInWorkingSection({ kind: "approval" })).toBe(false);
    expect(agentRowBelongsInWorkingSection({ kind: "input" })).toBe(false);
  });

  it("leaves finished, failed, stopped and idle threads in the active list", () => {
    expect(agentRowBelongsInWorkingSection({ kind: "done" })).toBe(false);
    expect(agentRowBelongsInWorkingSection({ kind: "failed" })).toBe(false);
    expect(agentRowBelongsInWorkingSection({ kind: "stopped" })).toBe(false);
    expect(agentRowBelongsInWorkingSection({ kind: "none" })).toBe(false);
  });

  it("agrees with the work tone for every status in the closed union", () => {
    expect(ALL_STATUSES).toHaveLength(11);
    for (const status of ALL_STATUSES) {
      expect(agentRowBelongsInWorkingSection(status)).toBe(agentRowStatusTone(status) === "work");
    }
  });

  it("narrows to a status that carries the turn start", () => {
    const status: AgentRowStatus = {
      kind: "agents",
      count: 1,
      lead: "working",
      startedAtEpochMs: 7,
    };
    const started = agentRowBelongsInWorkingSection(status) ? status.startedAtEpochMs : null;
    expect(started).toBe(7);
  });
});
