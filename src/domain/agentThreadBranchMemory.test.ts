import { describe, expect, it } from "vitest";
import {
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  MAX_AGENT_THREAD_BRANCH_MEMORY_ENTRIES,
  MAX_AGENT_THREAD_BRANCH_MEMORY_PERSISTED_CHARS,
  agentLocalCheckoutBranchMismatch,
  agentThreadBranchOf,
  parseAgentThreadBranchMemory,
  rememberAgentThreadBranch,
  serializeAgentThreadBranchMemory,
  type AgentThreadBranchIdentity,
} from "./agentThreadBranchMemory";

const THREAD_A: AgentThreadBranchIdentity = { threadId: "t-a", rootKey: "/repo", ownerId: "w1" };

describe("agentThreadBranchMemory", () => {
  it("remembers the branch per exact thread identity", () => {
    const memory = rememberAgentThreadBranch(EMPTY_AGENT_THREAD_BRANCH_MEMORY, THREAD_A, "main");
    expect(agentThreadBranchOf(memory, THREAD_A)).toBe("main");
    expect(agentThreadBranchOf(memory, { ...THREAD_A, ownerId: "w2" })).toBeNull();
    expect(agentThreadBranchOf(memory, { ...THREAD_A, rootKey: "/other" })).toBeNull();
  });

  it("returns the same memory when nothing changes", () => {
    const memory = rememberAgentThreadBranch(EMPTY_AGENT_THREAD_BRANCH_MEMORY, THREAD_A, "main");
    expect(rememberAgentThreadBranch(memory, THREAD_A, "main")).toBe(memory);
  });

  it("rejects blank, oversized or control-character branch names", () => {
    const base = EMPTY_AGENT_THREAD_BRANCH_MEMORY;
    expect(rememberAgentThreadBranch(base, THREAD_A, " ")).toBe(base);
    expect(rememberAgentThreadBranch(base, THREAD_A, "a".repeat(256))).toBe(base);
    expect(rememberAgentThreadBranch(base, THREAD_A, "bad\nname")).toBe(base);
  });

  it("evicts the least recently remembered thread deterministically", () => {
    let memory = EMPTY_AGENT_THREAD_BRANCH_MEMORY;
    for (let index = 0; index < MAX_AGENT_THREAD_BRANCH_MEMORY_ENTRIES; index += 1) {
      memory = rememberAgentThreadBranch(memory, { ...THREAD_A, threadId: `t-${index}` }, "main");
    }
    memory = rememberAgentThreadBranch(memory, { ...THREAD_A, threadId: "t-0" }, "dev");
    memory = rememberAgentThreadBranch(memory, { ...THREAD_A, threadId: "t-new" }, "main");
    expect(memory.size).toBe(MAX_AGENT_THREAD_BRANCH_MEMORY_ENTRIES);
    expect(agentThreadBranchOf(memory, { ...THREAD_A, threadId: "t-0" })).toBe("dev");
    expect(agentThreadBranchOf(memory, { ...THREAD_A, threadId: "t-1" })).toBeNull();
    expect(agentThreadBranchOf(memory, { ...THREAD_A, threadId: "t-new" })).toBe("main");
  });

  it("round-trips through the persisted form", () => {
    const memory = rememberAgentThreadBranch(EMPTY_AGENT_THREAD_BRANCH_MEMORY, THREAD_A, "main");
    const parsed = parseAgentThreadBranchMemory(serializeAgentThreadBranchMemory(memory));
    expect(agentThreadBranchOf(parsed, THREAD_A)).toBe("main");
  });

  it("keeps the persisted form within the byte cap by dropping the oldest threads", () => {
    let memory = EMPTY_AGENT_THREAD_BRANCH_MEMORY;
    const longRoot = "/r".repeat(2_000);
    for (let index = 0; index < MAX_AGENT_THREAD_BRANCH_MEMORY_ENTRIES; index += 1) {
      memory = rememberAgentThreadBranch(
        memory,
        { threadId: `t-${index}`, rootKey: longRoot, ownerId: longRoot },
        "main",
      );
    }
    const serialized = serializeAgentThreadBranchMemory(memory);
    expect(serialized.length).toBeLessThanOrEqual(MAX_AGENT_THREAD_BRANCH_MEMORY_PERSISTED_CHARS);
    const parsed = parseAgentThreadBranchMemory(serialized);
    expect(parsed.size).toBeGreaterThan(0);
    const newest = { threadId: `t-${MAX_AGENT_THREAD_BRANCH_MEMORY_ENTRIES - 1}` };
    expect(agentThreadBranchOf(parsed, { ...newest, rootKey: longRoot, ownerId: longRoot })).toBe(
      "main",
    );
    expect(
      agentThreadBranchOf(parsed, { threadId: "t-0", rootKey: longRoot, ownerId: longRoot }),
    ).toBeNull();
  });

  it("fails closed on malformed or unknown persisted payloads", () => {
    const invalid = [
      null,
      "",
      "not json",
      "{}",
      JSON.stringify({ version: 2, entries: [] }),
      JSON.stringify({ version: 1, entries: [["k", "main"]], extra: true }),
      JSON.stringify({ version: 1, entries: [[JSON.stringify(["t", "r"]), "main"]] }),
      JSON.stringify({ version: 1, entries: [[JSON.stringify(["t", "r", "o"]), ""]] }),
      JSON.stringify({ version: 1, entries: "nope" }),
      "x".repeat(300_000),
    ];
    for (const raw of invalid) {
      expect(parseAgentThreadBranchMemory(raw).size).toBe(0);
    }
  });

  it("rejects persisted payloads with too many entries", () => {
    const entries = Array.from({ length: MAX_AGENT_THREAD_BRANCH_MEMORY_ENTRIES + 1 }, (_, i) => [
      JSON.stringify([`t-${i}`, "/repo", "w1"]),
      "main",
    ]);
    expect(parseAgentThreadBranchMemory(JSON.stringify({ version: 1, entries })).size).toBe(0);
  });
});

describe("agentLocalCheckoutBranchMismatch", () => {
  const base = {
    isolation: "in-place" as const,
    worktreePath: null,
    remote: false,
    threadBranch: "main",
    currentBranch: "feature/sidebar",
  };

  it("reports a moved local checkout", () => {
    expect(agentLocalCheckoutBranchMismatch(base)).toEqual({
      threadBranch: "main",
      currentBranch: "feature/sidebar",
    });
  });

  it("stays silent when nothing moved or nothing is known", () => {
    expect(agentLocalCheckoutBranchMismatch({ ...base, currentBranch: "main" })).toBeNull();
    expect(agentLocalCheckoutBranchMismatch({ ...base, threadBranch: null })).toBeNull();
    expect(agentLocalCheckoutBranchMismatch({ ...base, currentBranch: null })).toBeNull();
  });

  it("never applies to worktree or server threads", () => {
    expect(agentLocalCheckoutBranchMismatch({ ...base, isolation: "worktree" })).toBeNull();
    expect(agentLocalCheckoutBranchMismatch({ ...base, worktreePath: "/wt" })).toBeNull();
    expect(agentLocalCheckoutBranchMismatch({ ...base, remote: true })).toBeNull();
  });
});
