import { describe, expect, it } from "vitest";
import { extractAgentArtifactReferences } from "./agentArtifact";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  mergeTurnEvents,
  type AgentTurn,
  type AgentTurnEvent,
} from "./agentThread";
import { agentTurnArtifactReferences } from "./agentTurnArtifactReferences";
import type { AgentTurnLogEvidence } from "./agentTurnContentLoss";

function evidence(overrides: Partial<AgentTurnLogEvidence> = {}): AgentTurnLogEvidence {
  return {
    loss: { kind: "none" },
    sealed: true,
    live: false,
    hydration: "complete",
    ...overrides,
  };
}

function turn(events: ReadonlyArray<AgentTurnEvent>, eventsTruncated = false): AgentTurn {
  return {
    turnId: "turn",
    prompt: "Create a design",
    status: { kind: "exited", exitCode: 0 },
    events,
    eventsTruncated,
    startedAtEpochMs: 0,
    endedAtEpochMs: 1,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
    cliVersion: null,
  };
}

describe("turn artifact references", () => {
  it("keeps complete assistant references and excludes non-assistant input", () => {
    expect(
      agentTurnArtifactReferences(
        turn([
          { kind: "userMessage", text: "[private](private.html)" },
          { kind: "reasoning", text: "[private](private.html)" },
          { kind: "assistantText", text: "[Design](art" },
          { kind: "assistantText", text: "ifacts/design.html)" },
          { kind: "result", text: "![Preview](preview.png)", isError: false, usage: null },
        ]),
        null,
      ),
    ).toEqual([
      { path: "artifacts/design.html", label: "Design" },
      { path: "preview.png", label: "Preview" },
    ]);
  });

  it("does not capture an example link after rolling eviction loses its fence opener", () => {
    const opening: AgentTurnEvent = { kind: "assistantText", text: "```markdown\n" };
    const example: AgentTurnEvent = { kind: "assistantText", text: "[Example](private.html)\n```" };
    const tools: AgentTurnEvent[] = Array.from(
      { length: MAX_AGENT_EVENTS_PER_TURN - 1 },
      (_, index) => ({
        kind: "toolCall",
        toolId: String(index),
        name: "Bash",
        inputSummary: "work",
      }),
    );
    expect(agentTurnArtifactReferences(turn([opening, ...tools, example]), null)).toEqual([]);
    const retained = mergeTurnEvents([opening, ...tools], [example]);
    expect(retained.truncated).toBe(true);
    expect(retained.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);
    expect(retained.events).not.toContain(opening);
    // Without the completeness guard, the retained suffix would authorize this file.
    expect(extractAgentArtifactReferences(example.text)).toEqual([
      { path: "private.html", label: "Example" },
    ]);
    expect(agentTurnArtifactReferences(turn(retained.events, retained.truncated), null)).toEqual(
      [],
    );
  });

  it("fails closed for any incomplete transcript, including a standalone final link", () => {
    expect(
      agentTurnArtifactReferences(
        turn(
          [{ kind: "result", text: "[Design](design.html)", isError: false, usage: null }],
          true,
        ),
        null,
      ),
    ).toEqual([]);
  });

  it("keeps the chips of a window truncated turn once the log rebuilt the whole window", () => {
    expect(
      agentTurnArtifactReferences(
        turn(
          [{ kind: "result", text: "[Design](design.html)", isError: false, usage: null }],
          true,
        ),
        evidence(),
      ),
    ).toEqual([{ path: "design.html", label: "Design" }]);
  });

  it("still refuses a truncated turn whose window was never rebuilt from its healthy log", () => {
    expect(
      agentTurnArtifactReferences(
        turn(
          [{ kind: "result", text: "[Design](design.html)", isError: false, usage: null }],
          true,
        ),
        evidence({ hydration: "notAttempted" }),
      ),
    ).toEqual([]);
  });

  it("refuses a turn whose log recorded real loss even when nothing left the window", () => {
    expect(
      agentTurnArtifactReferences(
        turn([{ kind: "result", text: "[Design](design.html)", isError: false, usage: null }]),
        evidence({ loss: { kind: "supervisorGap" } }),
      ),
    ).toEqual([]);
  });
});
