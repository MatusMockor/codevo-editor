import { describe, expect, it } from "vitest";
import { agentSessionActivityBar } from "./agentSessionActivityBar";

const agents = { count: 1, label: "1 agent running", names: "general-purpose" };

describe("agentSessionActivityBar", () => {
  it("hides the bar when neither agents nor background work run", () => {
    expect(agentSessionActivityBar(null, null)).toBeNull();
  });

  it("keeps foreground agents viewable without a background stop", () => {
    expect(agentSessionActivityBar(agents, null)).toEqual({
      label: "1 agent running",
      names: "general-purpose",
      actions: ["view"],
      announce: false,
    });
  });

  it("merges background agents after the turn into one bar with View and Stop", () => {
    expect(agentSessionActivityBar(agents, { kind: "agents", count: 1 })).toEqual({
      label: "1 agent running",
      names: "general-purpose",
      actions: ["view", "stop"],
      announce: true,
    });
  });

  it("never undercounts when native agent tasks outnumber projected subagents", () => {
    expect(agentSessionActivityBar(agents, { kind: "agents", count: 3 })?.label).toBe(
      "3 agents running",
    );
    expect(agentSessionActivityBar(null, { kind: "agents", count: 2 })).toEqual({
      label: "2 agents running",
      names: "",
      actions: ["stop"],
      announce: true,
    });
  });

  it("names background shell tasks next to running agents", () => {
    expect(agentSessionActivityBar(agents, { kind: "tasks", count: 2 })?.label).toBe(
      "1 agent running · 2 background tasks",
    );
    expect(agentSessionActivityBar(agents, { kind: "tasks", count: null })?.label).toBe(
      "1 agent running · background tasks",
    );
  });

  it("describes background tasks alone truthfully", () => {
    expect(agentSessionActivityBar(null, { kind: "tasks", count: 1 })).toEqual({
      label: "1 background task running",
      names: "",
      actions: ["stop"],
      announce: true,
    });
    expect(agentSessionActivityBar(null, { kind: "tasks", count: null })?.label).toBe(
      "Background tasks running",
    );
  });
});
