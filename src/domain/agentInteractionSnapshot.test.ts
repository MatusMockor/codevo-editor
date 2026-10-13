import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_INTERACTION_SNAPSHOT_APPROVALS,
  MAX_AGENT_INTERACTION_SNAPSHOT_QUESTIONS,
  parseAgentInteractionSnapshot,
} from "./agentInteractionSnapshot";

function question(id = "question", taskId = "task") {
  return {
    id,
    taskId,
    provider: "codex",
    status: "pending",
    questions: [
      {
        id: "q",
        header: "Choose",
        prompt: "Which?",
        multiple: false,
        allowCustom: true,
        options: [{ id: "a", label: "A", description: "" }],
      },
    ],
  };
}

function approval(id = "approval", taskId = "task") {
  return {
    id,
    taskId,
    provider: "claudeCode",
    kind: "command",
    title: "Run a command?",
    detail: "npm test",
    detailTruncated: false,
    facts: [],
    decisions: ["allowOnce", "deny"],
    status: "pending",
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "workspace",
    taskId: "task",
    sequence: 3,
    questions: [question()],
    approvals: [approval()],
    ...overrides,
  };
}

function many(count: number, item: (id: string) => unknown): readonly unknown[] {
  return Array.from({ length: count }, (_unused, index) => item(`item-${index}`));
}

describe("parseAgentInteractionSnapshot", () => {
  it("accepts the exact wire shape and the empty sequence 0 snapshot", () => {
    expect(parseAgentInteractionSnapshot(snapshot())).toEqual(snapshot());
    const empty = snapshot({ sequence: 0, questions: [], approvals: [] });
    expect(parseAgentInteractionSnapshot(empty)).toEqual(empty);
  });

  it("accepts settled requests and full lists", () => {
    const full = snapshot({
      sequence: Number.MAX_SAFE_INTEGER,
      questions: [
        ...many(MAX_AGENT_INTERACTION_SNAPSHOT_QUESTIONS - 1, (id) => question(id)),
        {
          ...question("answered"),
          status: "answered",
          answers: [{ questionId: "q", optionIds: ["a"], text: "" }],
        },
      ],
      approvals: [
        ...many(MAX_AGENT_INTERACTION_SNAPSHOT_APPROVALS - 1, (id) => approval(id)),
        { ...approval("denied"), status: "denied", decision: "deny" },
      ],
    });
    expect(parseAgentInteractionSnapshot(full)).toEqual(full);
  });

  it.each<{ readonly name: string; readonly value: unknown }>([
    { name: "null", value: null },
    { name: "an array", value: [snapshot()] },
    { name: "a string", value: JSON.stringify(snapshot()) },
    { name: "an unknown key", value: snapshot({ repositoryRoot: "/repo" }) },
    {
      name: "a missing key",
      value: { workspaceId: "workspace", taskId: "task", sequence: 3, questions: [] },
    },
    {
      name: "an undefined key in place of a required one",
      value: { ...snapshot(), approvals: undefined },
    },
  ])("rejects $name", ({ value }) => {
    expect(() => parseAgentInteractionSnapshot(value)).toThrow(
      "Invalid agent interaction snapshot.",
    );
  });

  it.each<{ readonly name: string; readonly sequence: unknown }>([
    { name: "a negative sequence", sequence: -1 },
    { name: "a fractional sequence", sequence: 1.5 },
    { name: "an unsafe sequence", sequence: Number.MAX_SAFE_INTEGER + 1 },
    { name: "a non-finite sequence", sequence: Number.POSITIVE_INFINITY },
    { name: "a textual sequence", sequence: "3" },
  ])("rejects $name", ({ sequence }) => {
    expect(() => parseAgentInteractionSnapshot(snapshot({ sequence }))).toThrow();
  });

  it.each<{ readonly name: string; readonly overrides: Record<string, unknown> }>([
    { name: "an empty workspace id", overrides: { workspaceId: "" } },
    { name: "a path-like workspace id", overrides: { workspaceId: "/Users/me/project" } },
    { name: "an oversize task id", overrides: { taskId: "t".repeat(129) } },
    { name: "a numeric task id", overrides: { taskId: 7 } },
  ])("rejects $name", ({ overrides }) => {
    expect(() =>
      parseAgentInteractionSnapshot(snapshot({ questions: [], approvals: [], ...overrides })),
    ).toThrow();
  });

  it.each<{ readonly name: string; readonly overrides: Record<string, unknown> }>([
    { name: "a question", overrides: { approvals: [] } },
    { name: "an approval", overrides: { questions: [] } },
    { name: "a question and an approval", overrides: {} },
  ])("rejects a sequence 0 snapshot that lists $name", ({ overrides }) => {
    expect(() => parseAgentInteractionSnapshot(snapshot({ sequence: 0, ...overrides }))).toThrow(
      "Invalid agent interaction snapshot.",
    );
    expect(parseAgentInteractionSnapshot(snapshot({ sequence: 1, ...overrides })).sequence).toBe(1);
  });

  it("rejects lists above the bound before accepting any item", () => {
    expect(() =>
      parseAgentInteractionSnapshot(
        snapshot({
          questions: many(MAX_AGENT_INTERACTION_SNAPSHOT_QUESTIONS + 1, (id) => question(id)),
        }),
      ),
    ).toThrow();
    expect(() =>
      parseAgentInteractionSnapshot(
        snapshot({
          approvals: many(MAX_AGENT_INTERACTION_SNAPSHOT_APPROVALS + 1, (id) => approval(id)),
        }),
      ),
    ).toThrow();
    expect(() => parseAgentInteractionSnapshot(snapshot({ questions: "none" }))).toThrow();
    expect(() => parseAgentInteractionSnapshot(snapshot({ approvals: null }))).toThrow();
  });

  it("rejects duplicate ids within a list and allows the same id across lists", () => {
    expect(() =>
      parseAgentInteractionSnapshot(snapshot({ questions: [question(), question()] })),
    ).toThrow();
    expect(() =>
      parseAgentInteractionSnapshot(snapshot({ approvals: [approval(), approval()] })),
    ).toThrow();
    const shared = snapshot({ questions: [question("shared")], approvals: [approval("shared")] });
    expect(parseAgentInteractionSnapshot(shared)).toEqual(shared);
  });

  it("rejects requests that belong to another task", () => {
    expect(() =>
      parseAgentInteractionSnapshot(snapshot({ questions: [question("question", "other")] })),
    ).toThrow();
    expect(() =>
      parseAgentInteractionSnapshot(snapshot({ approvals: [approval("approval", "other")] })),
    ).toThrow();
  });

  it("rejects malformed items through the request parsers", () => {
    expect(() =>
      parseAgentInteractionSnapshot(snapshot({ questions: [{ ...question(), env: "SECRET=1" }] })),
    ).toThrow();
    expect(() =>
      parseAgentInteractionSnapshot(snapshot({ approvals: [{ ...approval(), kind: "shell" }] })),
    ).toThrow();
  });
});
