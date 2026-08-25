import { describe, expect, it } from "vitest";
import { CLAUDE_EFFORT_CHOICES } from "./agentLaunch";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";

const STORED_TURN = {
  turnId: "agt-1-0a1b",
  prompt: "do the thing",
  status: { kind: "exited", exitCode: 0 },
  startedAtEpochMs: 1_000,
  endedAtEpochMs: 2_000,
  events: [],
  eventsTruncated: false,
  lastStatusSequence: 0,
  lastOutputSequence: 0,
} as const;

function storedThread(launch: unknown): Record<string, unknown> {
  return {
    threadId: "agt-t1-0001",
    owner: { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "do the thing",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 2_000,
    turns: [{ ...STORED_TURN, launch }],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
  };
}

describe("agentThreadWire launch effort", () => {
  it("fills the default effort for a stored claude turn written before the field existed", () => {
    const parsed = parseAgentThread(
      storedThread({ provider: "claudeCode", model: "sonnet", mode: "plan" }),
    );

    expect(parsed.turns[0].launch).toEqual({
      provider: "claudeCode",
      model: "sonnet",
      mode: "plan",
      effort: "default",
    });
  });

  it("round-trips every claude effort level through the store", () => {
    for (const effort of CLAUDE_EFFORT_CHOICES) {
      const launch = { provider: "claudeCode", model: "opus", mode: "acceptEdits", effort };
      const parsed = parseAgentThread(storedThread(launch));

      expect(parsed.turns[0].launch).toEqual(launch);
      expect(serializeAgentThread(parsed)).toEqual(storedThread(launch));
    }
  });

  it("keeps effort out of a stored codex turn and rejects an unknown level", () => {
    const codex = { provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" };
    expect(parseAgentThread(storedThread(codex)).turns[0].launch).toEqual(codex);

    expect(() => parseAgentThread(storedThread({ ...codex, effort: "low" }))).toThrow(TypeError);
    expect(() =>
      parseAgentThread(
        storedThread({ provider: "claudeCode", model: "opus", mode: "plan", effort: "ultra" }),
      ),
    ).toThrow(/thread\.turns\[0\]\.launch\.effort/);
  });

  it("keeps a turn without a launch record null", () => {
    const parsed = parseAgentThread(storedThread(null));

    expect(parsed.turns[0].launch).toBeNull();
    expect(serializeAgentThread(parsed)).toEqual(storedThread(null));
  });
});
