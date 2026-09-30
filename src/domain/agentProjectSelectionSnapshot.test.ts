import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_PROJECT_SELECTION_SNAPSHOT_CHARS,
  MAX_PERSISTED_AGENT_PROJECT_SELECTIONS,
  parseAgentProjectSelectionSnapshot,
  serializeAgentProjectSelectionSnapshot,
  type PersistedAgentProjectSelection,
} from "./agentProjectSelectionSnapshot";

function selection(
  overrides: Partial<PersistedAgentProjectSelection> = {},
): PersistedAgentProjectSelection {
  return {
    projectRootKey: "/work/app",
    threadId: "agt-one",
    repositoryRoot: "/work/app",
    ...overrides,
  };
}

describe("agent project selection snapshot", () => {
  it("round-trips selections in recency order", () => {
    const entries = [
      selection(),
      selection({ projectRootKey: "/work/api", threadId: null, repositoryRoot: null }),
    ];

    const raw = serializeAgentProjectSelectionSnapshot(entries);

    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
    expect(parseAgentProjectSelectionSnapshot(raw)).toEqual(entries);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["garbage", "{not json"],
    ["array", "[]"],
    ["wrong version", JSON.stringify({ version: 2, selections: [] })],
    ["unknown field", JSON.stringify({ version: 1, selections: [], extra: true })],
    ["selections not array", JSON.stringify({ version: 1, selections: {} })],
    ["oversized", "x".repeat(MAX_AGENT_PROJECT_SELECTION_SNAPSHOT_CHARS + 1)],
  ])("fails closed to no selections for %s input", (_label, raw) => {
    expect(parseAgentProjectSelectionSnapshot(raw)).toEqual([]);
  });

  it("drops malformed, remote and inconsistent entries but keeps valid ones", () => {
    const raw = JSON.stringify({
      version: 1,
      selections: [
        selection(),
        { ...selection({ projectRootKey: "/work/extra" }), extra: 1 },
        selection({ projectRootKey: "" }),
        selection({ projectRootKey: "remote:server:project" }),
        selection({ projectRootKey: "/work/remote", threadId: "remote-thread:x" }),
        selection({ projectRootKey: "/work/no-root", repositoryRoot: null }),
        selection({ projectRootKey: "/work/empty-root", repositoryRoot: "" }),
        { ...selection({ projectRootKey: "/work/number" }), threadId: 7 },
        selection({ projectRootKey: "/work/long", threadId: "t".repeat(300) }),
        "junk",
      ],
    });

    expect(parseAgentProjectSelectionSnapshot(raw)).toEqual([selection()]);
  });

  it("drops an empty selection whose repository root has the wrong type", () => {
    const raw = JSON.stringify({
      version: 1,
      selections: [
        { projectRootKey: "/work/app", threadId: null, repositoryRoot: 7 },
        selection({ projectRootKey: "/work/api" }),
      ],
    });

    expect(parseAgentProjectSelectionSnapshot(raw)).toEqual([
      selection({ projectRootKey: "/work/api" }),
    ]);
  });

  it("clears a stale repository root when no thread was selected", () => {
    const raw = JSON.stringify({
      version: 1,
      selections: [selection({ threadId: null, repositoryRoot: "/work/app" })],
    });

    expect(parseAgentProjectSelectionSnapshot(raw)).toEqual([
      selection({ threadId: null, repositoryRoot: null }),
    ]);
  });

  it("keeps only the newest entry for a duplicated project", () => {
    const raw = JSON.stringify({
      version: 1,
      selections: [selection({ threadId: "agt-old" }), selection({ threadId: "agt-new" })],
    });

    expect(parseAgentProjectSelectionSnapshot(raw)).toEqual([selection({ threadId: "agt-new" })]);
  });

  it("bounds the number of persisted projects keeping the most recent", () => {
    const entries = Array.from({ length: MAX_PERSISTED_AGENT_PROJECT_SELECTIONS + 5 }, (_, index) =>
      selection({ projectRootKey: `/work/p${index}` }),
    );

    const parsed = parseAgentProjectSelectionSnapshot(
      serializeAgentProjectSelectionSnapshot(entries),
    );

    expect(parsed).toHaveLength(MAX_PERSISTED_AGENT_PROJECT_SELECTIONS);
    expect(parsed[0]?.projectRootKey).toBe("/work/p5");
    expect(parsed[parsed.length - 1]?.projectRootKey).toBe(
      `/work/p${MAX_PERSISTED_AGENT_PROJECT_SELECTIONS + 4}`,
    );
  });

  it("never serializes more than the parser accepts", () => {
    const repositoryRoot = `/${"r".repeat(3_000)}`;
    const entries = Array.from({ length: MAX_PERSISTED_AGENT_PROJECT_SELECTIONS }, (_, index) =>
      selection({
        projectRootKey: `/work/${"p".repeat(4_000)}${index}`,
        repositoryRoot,
      }),
    );

    const raw = serializeAgentProjectSelectionSnapshot(entries);

    expect(raw.length).toBeLessThanOrEqual(MAX_AGENT_PROJECT_SELECTION_SNAPSHOT_CHARS);
    const parsed = parseAgentProjectSelectionSnapshot(raw);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[parsed.length - 1]?.projectRootKey).toBe(
      entries[entries.length - 1]?.projectRootKey,
    );
  });
});
