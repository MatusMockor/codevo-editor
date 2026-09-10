import { describe, expect, it } from "vitest";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import {
  AGENT_MINIMAP_DENSE_TURNS,
  AGENT_MINIMAP_NAME_CHARS,
  AGENT_MINIMAP_PREVIEW_CHARS,
  EMPTY_AGENT_MINIMAP,
  MAX_AGENT_MINIMAP_ENTRIES,
  agentMinimapDistance,
  agentMinimapEntryIndex,
  agentThreadMinimapModel,
} from "./agentThreadMinimapPresentation";

const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const RUNNING: AgentTurnStatus = { kind: "running" };

describe("agent thread minimap presentation", () => {
  it("marks one entry per user turn and names it by ordinal and prompt", () => {
    const model = agentThreadMinimapModel(
      thread(["Where do the Express routes live", "Add a Vitest case for wrapIndex"]),
    );

    expect(model.entries).toHaveLength(2);
    expect(model.turnCount).toBe(2);
    expect(model.folded).toBe(false);
    expect(model.density).toBe("comfortable");
    expect(model.entries[0]?.name).toBe("Turn 1 of 2: Where do the Express routes live");
    expect(model.entries[1]?.name).toBe("Turn 2 of 2: Add a Vitest case for wrapIndex");
    expect(model.entries[0]?.caption).toBe("turn 1");
    expect(model.entries[0]?.turnId).toBe("t1");
  });

  it("returns the shared empty model for a thread with no turns", () => {
    expect(agentThreadMinimapModel([])).toBe(EMPTY_AGENT_MINIMAP);
  });

  it("collapses whitespace and bounds the name and the preview", () => {
    const prompt = `line one\n\n${"context ".repeat(60)}`;
    const model = agentThreadMinimapModel(thread([prompt, "second"]));
    const entry = model.entries[0];

    expect(entry?.label.startsWith("line one context")).toBe(true);
    expect(entry?.label.length).toBeLessThanOrEqual(AGENT_MINIMAP_NAME_CHARS + 1);
    expect(entry?.preview.length).toBeLessThanOrEqual(AGENT_MINIMAP_PREVIEW_CHARS + 1);
    expect(entry?.preview.includes("\n")).toBe(false);
    expect(entry?.name.includes(entry?.label ?? "")).toBe(true);
  });

  it("stays comfortable below the compression threshold and compresses at it", () => {
    const loose = agentThreadMinimapModel(thread(prompts(AGENT_MINIMAP_DENSE_TURNS - 1)));
    const dense = agentThreadMinimapModel(thread(prompts(AGENT_MINIMAP_DENSE_TURNS)));

    expect(loose.density).toBe("comfortable");
    expect(loose.entries).toHaveLength(AGENT_MINIMAP_DENSE_TURNS - 1);
    expect(dense.density).toBe("dense");
    expect(dense.entries).toHaveLength(AGENT_MINIMAP_DENSE_TURNS);
    expect(dense.folded).toBe(false);
  });

  it("folds equal-sized groups once the dash budget is exhausted", () => {
    const model = agentThreadMinimapModel(thread(prompts(200)));

    expect(model.entries.length).toBeLessThanOrEqual(MAX_AGENT_MINIMAP_ENTRIES);
    expect(model.folded).toBe(true);
    expect(model.turnCount).toBe(200);
    expect(model.entries[0]?.count).toBe(4);
    expect(model.entries[0]?.name).toBe("Turns 1 to 4 of 200, 4 prompts");
    expect(model.entries[0]?.label).toBe("Turns 1 to 4");
    expect(model.entries[1]?.ordinal).toBe(5);
    expect(model.entries[1]?.turnId).toBe("t5");
  });

  it("reports a streaming turn and says so in the accessible name", () => {
    const turns = [turn("t1", "first", SETTLED), turn("t2", "second", RUNNING)];
    const model = agentThreadMinimapModel(turns);

    expect(model.entries[0]?.streaming).toBe(false);
    expect(model.entries[1]?.streaming).toBe(true);
    expect(model.entries[1]?.name).toBe("Turn 2 of 2: second, answer in progress");
  });

  it("resolves the entry covering an in-view turn, folded or not", () => {
    const flat = agentThreadMinimapModel(thread(prompts(3)));
    expect(agentMinimapEntryIndex(flat, "t2")).toBe(1);
    expect(agentMinimapEntryIndex(flat, null)).toBe(-1);
    expect(agentMinimapEntryIndex(flat, "missing")).toBe(-1);

    const folded = agentThreadMinimapModel(thread(prompts(200)));
    expect(agentMinimapEntryIndex(folded, "t7")).toBe(1);
    expect(folded.entries[1]?.ordinal).toBe(5);
  });

  it("clamps the proximity distance to the dash ladder", () => {
    expect(agentMinimapDistance(4, 4)).toBe(0);
    expect(agentMinimapDistance(6, 4)).toBe(2);
    expect(agentMinimapDistance(40, 4)).toBe(4);
    expect(agentMinimapDistance(0, -1)).toBe(4);
  });
});

function prompts(count: number): ReadonlyArray<string> {
  return Array.from({ length: count }, (_unused, index) => `prompt ${index + 1}`);
}

function thread(promptTexts: ReadonlyArray<string>): ReadonlyArray<AgentTurn> {
  return promptTexts.map((prompt, index) => turn(`t${index + 1}`, prompt, SETTLED));
}

function turn(turnId: string, prompt: string, status: AgentTurnStatus): AgentTurn {
  return {
    turnId,
    prompt,
    status,
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}
