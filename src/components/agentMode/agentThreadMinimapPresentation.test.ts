import { describe, expect, it } from "vitest";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import type { ExternalSessionExchange } from "../../domain/externalAgentSession";
import { agentImportedTurns } from "./agentImportedPresentation";
import { agentThreadColumnKey } from "./agentThreadColumn";
import {
  AGENT_MINIMAP_DENSE_TURNS,
  AGENT_MINIMAP_IMAGE_ONLY_LABEL,
  AGENT_MINIMAP_SOURCE_CHARS,
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
      [],
      thread(["Where do the Express routes live", "Add a Vitest case for wrapIndex"]),
    );

    expect(model.entries).toHaveLength(2);
    expect(model.turnCount).toBe(2);
    expect(model.folded).toBe(false);
    expect(model.density).toBe("comfortable");
    expect(model.entries[0]?.name).toBe("Turn 1 of 2: Where do the Express routes live");
    expect(model.entries[1]?.name).toBe("Turn 2 of 2: Add a Vitest case for wrapIndex");
    expect(model.entries[0]?.caption).toBe("turn 1");
    expect(model.entries[0]?.anchor).toEqual({ scope: "turn", turnId: "t1" });
  });

  it("names a turn by its displayed prompt, never by a hidden image store line", () => {
    const line = '[Attached image "shot.png" is saved at: /store/threads/agt-1/aa.png]';
    const model = agentThreadMinimapModel(
      imported([user(`imported ask\n\n${line}`), assistant("ok"), user(line)]),
      thread([
        `napis ahoj\n\n${line}`,
        line,
        `see\n\n[Attached file "n.txt" is saved at: /s/n.txt]`,
      ]),
    );

    expect(model.entries.map((entry) => entry.name)).toEqual([
      "Turn 1 of 5: imported ask",
      `Turn 2 of 5: ${AGENT_MINIMAP_IMAGE_ONLY_LABEL}`,
      "Turn 3 of 5: napis ahoj",
      `Turn 4 of 5: ${AGENT_MINIMAP_IMAGE_ONLY_LABEL}`,
      'Turn 5 of 5: see [Attached file "n.txt" is saved at: /s/n.txt]',
    ]);
    expect(model.entries.map((entry) => entry.preview)).not.toContain(
      expect.stringContaining("aa.png"),
    );
  });

  it("returns the shared empty model for a thread with no turns", () => {
    expect(agentThreadMinimapModel([], [])).toBe(EMPTY_AGENT_MINIMAP);
  });

  it("collapses whitespace and bounds the name and the preview", () => {
    const prompt = `line one\n\n${"context ".repeat(60)}`;
    const model = agentThreadMinimapModel([], thread([prompt, "second"]));
    const entry = model.entries[0];

    expect(entry?.label.startsWith("line one context")).toBe(true);
    expect(entry?.label.length).toBeLessThanOrEqual(AGENT_MINIMAP_NAME_CHARS + 1);
    expect(entry?.preview.length).toBeLessThanOrEqual(AGENT_MINIMAP_PREVIEW_CHARS + 1);
    expect(entry?.preview.includes("\n")).toBe(false);
    expect(entry?.name.includes(entry?.label ?? "")).toBe(true);
  });

  it("stays comfortable below the compression threshold and compresses at it", () => {
    const loose = agentThreadMinimapModel([], thread(prompts(AGENT_MINIMAP_DENSE_TURNS - 1)));
    const dense = agentThreadMinimapModel([], thread(prompts(AGENT_MINIMAP_DENSE_TURNS)));

    expect(loose.density).toBe("comfortable");
    expect(loose.entries).toHaveLength(AGENT_MINIMAP_DENSE_TURNS - 1);
    expect(dense.density).toBe("dense");
    expect(dense.entries).toHaveLength(AGENT_MINIMAP_DENSE_TURNS);
    expect(dense.folded).toBe(false);
  });

  it("folds equal-sized groups once the dash budget is exhausted", () => {
    const model = agentThreadMinimapModel([], thread(prompts(200)));

    expect(model.entries.length).toBeLessThanOrEqual(MAX_AGENT_MINIMAP_ENTRIES);
    expect(model.folded).toBe(true);
    expect(model.turnCount).toBe(200);
    expect(model.entries[0]?.count).toBe(4);
    expect(model.entries[0]?.name).toBe("Turns 1 to 4 of 200, 4 prompts");
    expect(model.entries[0]?.label).toBe("Turns 1 to 4");
    expect(model.entries[1]?.ordinal).toBe(5);
    expect(model.entries[1]?.anchor).toEqual({ scope: "turn", turnId: "t5" });
  });

  it("reports a streaming turn and says so in the accessible name", () => {
    const turns = [turn("t1", "first", SETTLED), turn("t2", "second", RUNNING)];
    const model = agentThreadMinimapModel([], turns);

    expect(model.entries[0]?.streaming).toBe(false);
    expect(model.entries[1]?.streaming).toBe(true);
    expect(model.entries[1]?.name).toBe("Turn 2 of 2: second, answer in progress");
  });

  it("resolves the entry covering an in-view turn, folded or not", () => {
    const flat = agentThreadMinimapModel([], thread(prompts(3)));
    expect(agentMinimapEntryIndex(flat, "turn:t2")).toBe(1);
    expect(agentMinimapEntryIndex(flat, null)).toBe(-1);
    expect(agentMinimapEntryIndex(flat, "turn:missing")).toBe(-1);

    const folded = agentThreadMinimapModel([], thread(prompts(200)));
    expect(agentMinimapEntryIndex(folded, "turn:t7")).toBe(1);
    expect(folded.entries[1]?.ordinal).toBe(5);
  });

  it("clamps the proximity distance to the dash ladder", () => {
    expect(agentMinimapDistance(4, 4)).toBe(0);
    expect(agentMinimapDistance(6, 4)).toBe(2);
    expect(agentMinimapDistance(40, 4)).toBe(4);
    expect(agentMinimapDistance(0, -1)).toBe(4);
  });

  it("spans imported exchanges and live turns as one numbered column", () => {
    const model = agentThreadMinimapModel(
      imported([user("imported one"), assistant("alpha"), user("imported two")]),
      thread(["live one"]),
    );

    expect(model.turnCount).toBe(3);
    expect(model.entries.map((entry) => entry.anchor)).toEqual([
      { scope: "imported", exchangeIndex: 0 },
      { scope: "imported", exchangeIndex: 2 },
      { scope: "turn", turnId: "t1" },
    ]);
    expect(model.entries.map((entry) => entry.name)).toEqual([
      "Turn 1 of 3: imported one",
      "Turn 2 of 3: imported two",
      "Turn 3 of 3: live one",
    ]);
    expect(model.entries.map((entry) => entry.key)).toEqual([
      "imported:0",
      "imported:2",
      "turn:t1",
    ]);
  });

  it("populates the rail for a thread that has only imported exchanges", () => {
    const model = agentThreadMinimapModel(
      imported([user("one"), assistant("alpha"), user("two"), assistant("beta")]),
      [],
    );

    expect(model).not.toBe(EMPTY_AGENT_MINIMAP);
    expect(model.turnCount).toBe(2);
    expect(model.entries.map((entry) => entry.caption)).toEqual(["turn 1", "turn 2"]);
    expect(model.entries.every((entry) => entry.streaming)).toBe(false);
  });

  it("resolves an in-view imported entry through the same column key the DOM carries", () => {
    const model = agentThreadMinimapModel(
      imported([user("one"), user("two")]),
      thread(["live one"]),
    );

    const second = agentThreadColumnKey({ scope: "imported", exchangeIndex: 1 });
    expect(second).toBe("imported:1");
    expect(agentMinimapEntryIndex(model, second)).toBe(1);
    expect(agentMinimapEntryIndex(model, "turn:t1")).toBe(2);
  });

  it("names a leading imported answer that has no prompt of its own", () => {
    const model = agentThreadMinimapModel(
      imported([assistant("an opening answer"), user("then a prompt")]),
      [],
    );

    expect(model.entries.map((entry) => entry.label)).toEqual([
      "an opening answer",
      "then a prompt",
    ]);
    expect(model.entries[0]?.anchor).toEqual({ scope: "imported", exchangeIndex: 0 });
  });

  it("folds a mixed column into groups that keep the column-wide ordinals", () => {
    const model = agentThreadMinimapModel(
      imported(prompts(100).map((text) => user(text))),
      thread(prompts(100)),
    );

    expect(model.turnCount).toBe(200);
    expect(model.entries.length).toBeLessThanOrEqual(MAX_AGENT_MINIMAP_ENTRIES);
    expect(model.folded).toBe(true);
    expect(model.entries[0]?.name).toBe("Turns 1 to 4 of 200, 4 prompts");
    expect(model.entries[0]?.anchor).toEqual({ scope: "imported", exchangeIndex: 0 });
    expect(model.entries[model.entries.length - 1]?.anchor).toEqual({
      scope: "turn",
      turnId: "t97",
    });
  });

  it("keeps one entry per rendered imported article across adversarial shapes", () => {
    const shapes: ReadonlyArray<ReadonlyArray<ExternalSessionExchange>> = [
      [assistant("lead")],
      [assistant("lead"), assistant("second")],
      [user("only a prompt")],
      [user("first"), user("second")],
      [assistant("lead"), user("first"), assistant("answer"), user("second")],
      [user("a"), assistant("b"), assistant("c"), user("d"), user("e"), assistant("f")],
    ];

    for (const exchanges of shapes) {
      const turns = imported(exchanges);
      const model = agentThreadMinimapModel(turns, []);
      const heads = turns.map((entry) => entry.headExchangeIndex);

      expect(model.turnCount).toBe(turns.length);
      expect(model.entries.map((entry) => entry.anchor)).toEqual(
        turns.map((entry) => ({ scope: "imported", exchangeIndex: entry.headExchangeIndex })),
      );
      expect(new Set(heads).size).toBe(heads.length);
      expect([...heads]).toEqual([...heads].sort((left, right) => left - right));
    }
  });

  it("bounds the text it reads out of one column entry", () => {
    const model = agentThreadMinimapModel(
      imported([user("a".repeat(200_000)), user("second")]),
      [],
    );

    expect(model.entries[0]?.preview.length).toBeLessThanOrEqual(AGENT_MINIMAP_PREVIEW_CHARS + 1);
    expect(model.entries[0]?.label.length).toBeLessThanOrEqual(AGENT_MINIMAP_NAME_CHARS + 1);
  });

  it("never reads past the source bound, however much whitespace comes first", () => {
    const beyond = `${" ".repeat(AGENT_MINIMAP_SOURCE_CHARS)}text past the bound`;
    const model = agentThreadMinimapModel(imported([user(beyond), user("second")]), []);

    expect(model.entries[0]?.preview).toBe("");
    expect(model.entries[0]?.label).toBe("");
  });

  it("keeps the source bound off the seam of a surrogate pair", () => {
    const head = `${"a".repeat(AGENT_MINIMAP_SOURCE_CHARS - 1)}😀`;
    const model = agentThreadMinimapModel(imported([user(head), user("second")]), []);
    const preview = model.entries[0]?.preview ?? "";

    for (const character of preview) {
      const code = character.codePointAt(0) ?? 0;
      expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
    }
  });
});

function user(text: string): ExternalSessionExchange {
  return { role: "user", text };
}

function assistant(text: string): ExternalSessionExchange {
  return { role: "assistant", text };
}

function imported(exchanges: ReadonlyArray<ExternalSessionExchange>) {
  return agentImportedTurns(exchanges);
}

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
