// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_TURN_UNTIMED } from "../agentTurnHeadPresentation";
import { AgentTurnMeta } from "./AgentTurnMeta";
import { agentClockTime } from "./agentTurnMetaLine";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("AgentTurnMeta", () => {
  it("lists time, agent and settled duration in the mockup order", () => {
    const at = Date.UTC(2026, 8, 24, 8, 42, 0);
    act(() =>
      root.render(
        <AgentTurnMeta
          agentLabel="Opus 5.5"
          atEpochMs={at}
          timing={{ kind: "elapsed", elapsedMs: 98_000 }}
        />,
      ),
    );

    const meta = host.querySelector<HTMLElement>(".cv-turn-meta");
    expect([...(meta?.children ?? [])].map((child) => child.className)).toEqual([
      "cv-turn-meta__time",
      "cv-turn-meta__agent",
      "cv-turn-meta__duration",
    ]);
    expect(meta?.querySelector("time")?.textContent).toBe(agentClockTime(at)?.label);
    expect(meta?.querySelector("time")?.getAttribute("datetime")).toBe(new Date(at).toISOString());
    expect(meta?.querySelector(".cv-turn-meta__agent")?.textContent).toBe("Opus 5.5");
    expect(meta?.querySelector(".cv-turn-meta__duration")?.textContent).toBe("1m 38s");
  });

  it("shows only the agent for an imported answer without time", () => {
    act(() =>
      root.render(
        <AgentTurnMeta agentLabel="Claude Code" atEpochMs={null} timing={AGENT_TURN_UNTIMED} />,
      ),
    );

    const meta = host.querySelector<HTMLElement>(".cv-turn-meta");
    expect([...(meta?.children ?? [])].map((child) => child.className)).toEqual([
      "cv-turn-meta__agent",
    ]);
  });
});
