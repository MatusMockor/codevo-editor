import { describe, expect, it, vi } from "vitest";
import { createAgentTurnChangesReader } from "./agentTurnChangesReader";
import type { AgentTurnChangeSummary } from "../domain/agentTurnChanges";
const summary = (turnId = "old"): AgentTurnChangeSummary => ({
  turnId,
  state: "ready",
  files: [
    {
      relativePath: "src/a.ts",
      oldRelativePath: null,
      status: "modified",
      addedLines: 1,
      deletedLines: 1,
    },
  ],
  truncated: false,
  reason: null,
});
const diff = {
  relativePath: "src/a.ts",
  original: { text: "before", truncated: false },
  modified: { text: "after", truncated: false },
  unavailableReason: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("recorded turn change reader", () => {
  it("coalesces summaries and admits only recorded safe file paths", async () => {
    const getSummary = vi.fn(async () => summary());
    const getFileDiff = vi.fn(async () => diff);
    const lease = {};
    const reader = createAgentTurnChangesReader((thread, turn) =>
      thread === "t" && turn === "old"
        ? { lease, identity: "owner", getSummary, getFileDiff }
        : null,
    );
    await Promise.all([reader.getTurnChanges("t", "old"), reader.getTurnChanges("t", "old")]);
    expect(getSummary).toHaveBeenCalledOnce();
    expect(await reader.getTurnFileDiff("t", "old", "src/a.ts")).toEqual(diff);
    await expect(reader.getTurnFileDiff("t", "old", "src/foreign.ts")).rejects.toThrow();
    await expect(reader.getTurnFileDiff("t", "old", "../secret")).rejects.toThrow();
    expect((await reader.getTurnChanges("foreign", "old")).state).toBe("unavailable");
    expect(getFileDiff).toHaveBeenCalledOnce();
  });
  it("rejects late summaries and diffs after an A-B-A owner replacement", async () => {
    let lease = {};
    const pending = deferred<AgentTurnChangeSummary>();
    const reader = createAgentTurnChangesReader(() => ({
      lease,
      identity: "owner",
      getSummary: () => pending.promise,
      getFileDiff: async () => diff,
    }));
    const result = reader.getTurnChanges("t", "old");
    lease = {};
    pending.resolve(summary());
    expect((await result).state).toBe("unavailable");
    const pendingDiff = deferred<typeof diff>();
    const second = createAgentTurnChangesReader(() => ({
      lease,
      identity: "owner",
      getSummary: async () => summary(),
      getFileDiff: () => pendingDiff.promise,
    }));
    await second.getTurnChanges("t", "old");
    const read = second.getTurnFileDiff("t", "old", "src/a.ts");
    await Promise.resolve();
    lease = {};
    pendingDiff.resolve(diff);
    await expect(read).rejects.toThrow();
  });
  it("does not publish a foreign response or retain a synchronous failure", async () => {
    const getSummary = vi
      .fn<() => Promise<AgentTurnChangeSummary>>()
      .mockImplementationOnce(() => {
        throw Error("offline");
      })
      .mockResolvedValueOnce(summary("foreign"))
      .mockResolvedValue(summary());
    const lease = {};
    const reader = createAgentTurnChangesReader(() => ({
      lease,
      identity: "owner",
      getSummary,
      getFileDiff: async () => ({ ...diff, relativePath: "wrong.ts" }),
    }));
    expect((await reader.getTurnChanges("t", "old")).state).toBe("unavailable");
    expect((await reader.getTurnChanges("t", "old")).state).toBe("unavailable");
    expect((await reader.getTurnChanges("t", "old")).state).toBe("ready");
    await expect(reader.getTurnFileDiff("t", "old", "src/a.ts")).rejects.toThrow();
  });
  it("does not dispatch a queued read after its owner is revoked before the microtask", async () => {
    let lease = {};
    const getSummary = vi.fn(async () => summary());
    const reader = createAgentTurnChangesReader(() => ({
      lease,
      identity: "owner",
      getSummary,
      getFileDiff: async () => diff,
    }));
    const pending = reader.getTurnChanges("t", "old");
    lease = {};
    expect((await pending).state).toBe("unavailable");
    expect(getSummary).not.toHaveBeenCalled();
    const disposed = reader.getTurnChanges("t", "old");
    reader.dispose();
    expect((await disposed).state).toBe("unavailable");
    expect(getSummary).not.toHaveBeenCalled();
  });
  it("retries an unavailable recorded summary instead of caching the failure", async () => {
    const lease = {};
    const getSummary = vi
      .fn<() => Promise<AgentTurnChangeSummary>>()
      .mockResolvedValueOnce({
        turnId: "old",
        state: "unavailable",
        files: [],
        truncated: false,
        reason: "Capture pending",
      })
      .mockResolvedValue(summary());
    const reader = createAgentTurnChangesReader(() => ({
      lease,
      identity: "owner",
      getSummary,
      getFileDiff: async () => diff,
    }));
    expect((await reader.getTurnChanges("t", "old")).state).toBe("unavailable");
    expect((await reader.getTurnChanges("t", "old")).state).toBe("ready");
    expect(getSummary).toHaveBeenCalledTimes(2);
  });
  it("bounds simultaneous requests and evicts old summary entries", async () => {
    const pending = deferred<AgentTurnChangeSummary>();
    const lease = {};
    const getSummary = vi.fn(() => pending.promise);
    const busy = createAgentTurnChangesReader(() => ({
      lease,
      identity: "owner",
      getSummary,
      getFileDiff: async () => diff,
    }));
    const jobs = Array.from({ length: 64 }, (_, i) => busy.getTurnChanges("t", String(i)));
    expect((await busy.getTurnChanges("t", "overflow")).reason).toContain("Too many");
    pending.resolve(summary("0"));
    await Promise.all(jobs);
    expect(getSummary).toHaveBeenCalledTimes(64);
    const reads = vi.fn(async (turn: string) => summary(turn));
    const cached = createAgentTurnChangesReader((_, turn) => ({
      lease,
      identity: "owner",
      getSummary: () => reads(turn),
      getFileDiff: async () => diff,
    }));
    for (let i = 0; i < 33; i++) await cached.getTurnChanges("t", String(i));
    await cached.getTurnChanges("t", "0");
    expect(reads).toHaveBeenCalledTimes(34);
    cached.dispose();
    expect((await cached.getTurnChanges("t", "0")).state).toBe("unavailable");
  });
});
