import { describe, expect, it, vi } from "vitest";
import {
  authorizedTurnChanges,
  createAgentTurnChangesReader,
  TURN_CHANGES_NOT_APPLICABLE,
  type AgentTurnChangesReadAuthority,
} from "./agentTurnChangesReader";
import {
  classifyTurnChangesReadFailure,
  isRetryableTurnChangesReason,
  TRANSIENT_BACKEND_READ_ERRORS,
  turnChangesReadFailureReason,
} from "./agentTurnChangesReadQueue";
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
function readerFor(
  resolve: (threadId: string, turnId: string) => AgentTurnChangesReadAuthority | null,
) {
  return createAgentTurnChangesReader((threadId, turnId) => {
    const authority = resolve(threadId, turnId);
    if (authority === null) return TURN_CHANGES_NOT_APPLICABLE;
    return authorizedTurnChanges(authority);
  });
}
describe("recorded turn change reader", () => {
  it("coalesces summaries and admits only recorded safe file paths", async () => {
    const getSummary = vi.fn(async () => summary());
    const getFileDiff = vi.fn(async () => diff);
    const lease = {};
    const reader = readerFor((thread, turn) =>
      thread === "t" && turn === "old"
        ? { lease, identity: "owner", getSummary, getFileDiff }
        : null,
    );
    await Promise.all([reader.getTurnChanges("t", "old"), reader.getTurnChanges("t", "old")]);
    expect(getSummary).toHaveBeenCalledOnce();
    expect(await reader.getTurnFileDiff("t", "old", "src/a.ts")).toEqual(diff);
    await expect(reader.getTurnFileDiff("t", "old", "src/foreign.ts")).rejects.toThrow();
    await expect(reader.getTurnFileDiff("t", "old", "../secret")).rejects.toThrow();
    expect((await reader.getTurnChanges("foreign", "old")).state).toBe("unsupported");
    expect(getFileDiff).toHaveBeenCalledOnce();
  });
  it("reports a closed authority denial as an unavailable line without reading", async () => {
    const reader = createAgentTurnChangesReader(() => ({
      kind: "denied",
      reason: "ownerMismatch",
    }));
    const result = await reader.getTurnChanges("t", "old");
    expect(result).toEqual({
      turnId: "old",
      state: "unavailable",
      files: [],
      truncated: false,
      reason: "Recorded changes belong to a project session that is no longer open.",
    });
    expect(isRetryableTurnChangesReason(result.reason)).toBe(false);
    await expect(reader.getTurnFileDiff("t", "old", "src/a.ts")).rejects.toThrow(
      "Recorded changes belong to a project session that is no longer open.",
    );
  });
  it("drops a cached summary and its lease once the authority is denied or not applicable", async () => {
    const lease = {};
    const authority: AgentTurnChangesReadAuthority = {
      lease,
      identity: "owner",
      getSummary: async () => summary(),
      getFileDiff: async () => diff,
    };
    let resolution: "authorized" | "denied" | "notApplicable" = "authorized";
    const reader = createAgentTurnChangesReader(() => {
      if (resolution === "denied") return { kind: "denied", reason: "ownerMismatch" };
      if (resolution === "notApplicable") return TURN_CHANGES_NOT_APPLICABLE;
      return authorizedTurnChanges(authority);
    });
    expect((await reader.getTurnChanges("t", "old")).state).toBe("ready");
    expect(reader.retainsLease(lease)).toBe(true);
    resolution = "denied";
    expect((await reader.getTurnChanges("t", "old")).state).toBe("unavailable");
    expect(reader.retainsLease(lease)).toBe(false);
    resolution = "authorized";
    expect((await reader.getTurnChanges("t", "old")).state).toBe("ready");
    expect(reader.retainsLease(lease)).toBe(true);
    resolution = "notApplicable";
    expect((await reader.getTurnChanges("t", "old")).state).toBe("unsupported");
    expect(reader.retainsLease(lease)).toBe(false);
  });
  it("releases a pending read lease when the authority is denied mid-flight", async () => {
    const lease = {};
    const pending = deferred<AgentTurnChangeSummary>();
    let denied = false;
    const reader = createAgentTurnChangesReader(() =>
      denied
        ? { kind: "denied", reason: "ownerMismatch" }
        : authorizedTurnChanges({
            lease,
            identity: "owner",
            getSummary: () => pending.promise,
            getFileDiff: async () => diff,
          }),
    );
    const first = reader.getTurnChanges("t", "old");
    expect(reader.retainsLease(lease)).toBe(true);
    denied = true;
    expect((await reader.getTurnChanges("t", "old")).state).toBe("unavailable");
    expect(reader.retainsLease(lease)).toBe(false);
    pending.resolve(summary());
    expect((await first).state).toBe("unsupported");
    expect(reader.retainsLease(lease)).toBe(false);
  });
  it("rejects late summaries and diffs after an A-B-A owner replacement", async () => {
    let lease = {};
    const pending = deferred<AgentTurnChangeSummary>();
    const reader = readerFor(() => ({
      lease,
      identity: "owner",
      getSummary: () => pending.promise,
      getFileDiff: async () => diff,
    }));
    const result = reader.getTurnChanges("t", "old");
    lease = {};
    pending.resolve(summary());
    expect((await result).state).toBe("unsupported");
    const pendingDiff = deferred<typeof diff>();
    const second = readerFor(() => ({
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
    const reader = readerFor(() => ({
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
    const reader = readerFor(() => ({
      lease,
      identity: "owner",
      getSummary,
      getFileDiff: async () => diff,
    }));
    const pending = reader.getTurnChanges("t", "old");
    lease = {};
    expect((await pending).state).toBe("unsupported");
    expect(getSummary).not.toHaveBeenCalled();
    const disposed = reader.getTurnChanges("t", "old");
    reader.dispose();
    expect((await disposed).state).toBe("unsupported");
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
    const reader = readerFor(() => ({
      lease,
      identity: "owner",
      getSummary,
      getFileDiff: async () => diff,
    }));
    expect((await reader.getTurnChanges("t", "old")).state).toBe("unavailable");
    expect((await reader.getTurnChanges("t", "old")).state).toBe("ready");
    expect(getSummary).toHaveBeenCalledTimes(2);
  });
  it("evicts old summary entries", async () => {
    const lease = {};
    const reads = vi.fn(async (turn: string) => summary(turn));
    const cached = readerFor((_, turn) => ({
      lease,
      identity: "owner",
      getSummary: () => reads(turn),
      getFileDiff: async () => diff,
    }));
    for (let i = 0; i < 33; i++) await cached.getTurnChanges("t", String(i));
    await cached.getTurnChanges("t", "0");
    expect(reads).toHaveBeenCalledTimes(34);
    cached.dispose();
    expect((await cached.getTurnChanges("t", "0")).state).toBe("unsupported");
  });
});

it("shares four read slots across readers and file diffs, then drains every turn", async () => {
  const lease = {};
  const gate = deferred<void>();
  let active = 0;
  let peak = 0;
  const read = async <T>(value: T) => {
    active += 1;
    peak = Math.max(peak, active);
    await gate.promise;
    active -= 1;
    return value;
  };
  const createReader = () =>
    readerFor((_, turn) => ({
      lease,
      identity: "owner",
      getSummary: () => read(summary(turn)),
      getFileDiff: () => read(diff),
    }));
  const first = createReader();
  const second = createReader();
  const jobs = Array.from({ length: 80 }, (_, i) =>
    (i % 2 ? first : second).getTurnChanges("t", String(i)),
  );
  const file = first.getTurnFileDiff("t", "1", "src/a.ts");
  await vi.waitFor(() => expect(active).toBe(4));
  gate.resolve();
  expect((await Promise.all(jobs)).every((value) => value.state === "ready")).toBe(true);
  expect(await file).toEqual(diff);
  expect(peak).toBe(4);
});
it("cancels disposed queued readers without dispatching and releases failed slots", async () => {
  const lease = {};
  const gate = deferred<void>();
  let active = 0;
  const holder = readerFor(() => ({
    lease,
    identity: "owner",
    getSummary: async () => {
      active += 1;
      await gate.promise;
      throw new Error("failure with private source data");
    },
    getFileDiff: async () => diff,
  }));
  const holding = Array.from({ length: 4 }, (_, i) => holder.getTurnChanges("t", String(i)));
  await vi.waitFor(() => expect(active).toBe(4));
  const getSummary = vi.fn(async () => summary());
  const waiting = readerFor(() => ({
    lease,
    identity: "owner",
    getSummary,
    getFileDiff: async () => diff,
  }));
  const queued = waiting.getTurnChanges("t", "old");
  await Promise.resolve();
  waiting.dispose();
  expect((await queued).state).toBe("unsupported");
  expect(getSummary).not.toHaveBeenCalled();
  gate.resolve();
  const failures = await Promise.all(holding);
  expect(failures.every((value) => !value.reason?.includes("private"))).toBe(true);
  const recovery = readerFor(() => ({
    lease,
    identity: "owner",
    getSummary,
    getFileDiff: async () => diff,
  }));
  expect((await recovery.getTurnChanges("t", "old")).state).toBe("ready");
});
it("rejects an owner replaced while waiting behind active reads", async () => {
  let lease = {};
  const gate = deferred<void>();
  const calls: string[] = [];
  const reader = readerFor((_, turn) => ({
    lease,
    identity: "owner",
    getSummary: async () => {
      calls.push(turn);
      await gate.promise;
      return summary(turn);
    },
    getFileDiff: async () => diff,
  }));
  const jobs = Array.from({ length: 8 }, (_, i) => reader.getTurnChanges("t", String(i)));
  await vi.waitFor(() => expect(calls).toHaveLength(4));
  lease = {};
  gate.resolve();
  expect((await Promise.all(jobs)).every((value) => value.state === "unsupported")).toBe(true);
  expect(calls).toHaveLength(4);
});
it("retries only the recognized transient read limit and treats trust rejection as not applicable", async () => {
  const lease = {};
  const getSummary = vi
    .fn<() => Promise<AgentTurnChangeSummary>>()
    .mockRejectedValueOnce("Too many turn changes reads. Try again shortly.")
    .mockResolvedValueOnce(summary())
    .mockRejectedValue("Viewing turn changes requires a trusted workspace.");
  const reader = readerFor(() => ({
    lease,
    identity: "owner",
    getSummary,
    getFileDiff: async () => diff,
  }));
  expect((await reader.getTurnChanges("t", "old")).state).toBe("ready");
  expect(getSummary).toHaveBeenCalledTimes(2);
  expect(await reader.getTurnChanges("t", "other")).toEqual({
    turnId: "other",
    state: "unsupported",
    files: [],
    truncated: false,
    reason: "notApplicable",
  });
  expect(getSummary).toHaveBeenCalledTimes(3);
});

it("bounds retry attempts when another backend reader keeps the service busy", async () => {
  const lease = {};
  const getSummary = vi.fn().mockRejectedValue("Too many turn changes reads. Try again shortly.");
  const reader = readerFor(() => ({
    lease,
    identity: "owner",
    getSummary,
    getFileDiff: async () => diff,
  }));
  expect((await reader.getTurnChanges("t", "old")).reason).toContain("Too many turn changes reads");
  expect(getSummary).toHaveBeenCalledTimes(3);
});
it("does not retry a transient failure after its owner is disposed", async () => {
  const lease = {};
  const getSummary = vi.fn().mockRejectedValue("Too many turn changes reads. Try again shortly.");
  const reader = readerFor(() => ({
    lease,
    identity: "owner",
    getSummary,
    getFileDiff: async () => diff,
  }));
  const result = reader.getTurnChanges("t", "old");
  await vi.waitFor(() => expect(getSummary).toHaveBeenCalledOnce(), { interval: 1 });
  reader.dispose();
  expect((await result).state).toBe("unsupported");
  expect(getSummary).toHaveBeenCalledOnce();
});
it("reports malformed saved responses as invalid without exposing their content", async () => {
  const lease = {};
  const reader = readerFor(() => ({
    lease,
    identity: "owner",
    getSummary: async () => ({ ...summary(), files: [], unexpectedPrivateField: "secret" }),
    getFileDiff: async () => diff,
  }));
  expect((await reader.getTurnChanges("t", "old")).reason).toBe(
    "The saved changes response is invalid and cannot be displayed.",
  );
});
it("bounds the waiting queue and coalesces duplicate requests while queued", async () => {
  const lease = {};
  const gate = deferred<void>();
  const getSummary = vi.fn(async (turn: string) => {
    await gate.promise;
    return summary(turn);
  });
  const reader = readerFor((_, turn) => ({
    lease,
    identity: "owner",
    getSummary: () => getSummary(turn),
    getFileDiff: async () => diff,
  }));
  const jobs = Array.from({ length: 1028 }, (_, i) => reader.getTurnChanges("t", String(i)));
  const duplicate = reader.getTurnChanges("t", "1027");
  expect((await reader.getTurnChanges("t", "overflow")).reason).toContain("queue is full");
  gate.resolve();
  expect((await Promise.all(jobs)).every((value) => value.state === "ready")).toBe(true);
  expect((await duplicate).state).toBe("ready");
  expect(getSummary).toHaveBeenCalledTimes(1028);
});

it("classifies transient, final and not-applicable read failures for the view", async () => {
  const lease = {};
  const failures = [
    "Saved turn changes could not be read.",
    "Turn changes workspace is unavailable.",
    "Saved turn changes are invalid.",
    "Recorded changes owner is no longer available.",
    "/private/secret detail",
  ];
  const reader = readerFor((_, turn) => ({
    lease,
    identity: "owner",
    getSummary: async () => {
      throw new Error(failures[Number(turn)]);
    },
    getFileDiff: async () => diff,
  }));
  const results = await Promise.all(failures.map((_, i) => reader.getTurnChanges("t", String(i))));
  expect(results.map((value) => [value.state, value.reason])).toEqual([
    ["unavailable", "Saved turn changes could not be read."],
    ["unavailable", "Turn changes workspace is unavailable."],
    ["unavailable", "Saved turn changes are invalid."],
    ["unsupported", "notApplicable"],
    ["unavailable", "Recorded changes could not be loaded."],
  ]);
  expect(results.map((value) => isRetryableTurnChangesReason(value.reason))).toEqual([
    true,
    true,
    false,
    false,
    false,
  ]);
});
it("pins the transient backend read errors shared with the Rust read_errors module", () => {
  expect(TRANSIENT_BACKEND_READ_ERRORS).toEqual([
    "Too many turn changes reads. Try again shortly.",
    "Workspace trust changed while loading turn changes.",
    "Turn changes workspace is unavailable.",
    "Saved turn changes are unavailable.",
    "Saved turn changes could not be read.",
  ]);
  for (const message of TRANSIENT_BACKEND_READ_ERRORS)
    expect(classifyTurnChangesReadFailure(new Error(message))).toEqual({
      kind: "retryable",
      reason: message,
    });
});
it("treats permanent backend validation errors and unknown failures as final", () => {
  for (const message of [
    "Saved turn changes contain invalid checkpoint data.",
    "Saved turn changes do not match their checkpoints.",
    "Saved turn changes belong to a different workspace or turn.",
    "Saved turn changes contain invalid summary data.",
    "Saved turn changes contain invalid file data.",
    "Saved turn changes contain invalid checkpoint identity.",
    "Saved turn changes cannot be read safely.",
    "Something new went wrong",
    "",
  ]) {
    const failure = classifyTurnChangesReadFailure(new Error(message));
    expect(failure).toEqual({ kind: "final", reason: "Recorded changes could not be loaded." });
    expect(isRetryableTurnChangesReason(turnChangesReadFailureReason(new Error(message)))).toBe(
      false,
    );
  }
  expect(classifyTurnChangesReadFailure("not an error")).toEqual({
    kind: "final",
    reason: "Recorded changes could not be loaded.",
  });
});
it("offers retry when backend read admission stays busy", async () => {
  const getSummary = vi.fn(async (): Promise<AgentTurnChangeSummary> => {
    throw new Error("Too many turn changes reads. Try again shortly.");
  });
  const lease = {};
  const reader = readerFor(() => ({
    lease,
    identity: "owner",
    getSummary,
    getFileDiff: async () => diff,
  }));
  const result = await reader.getTurnChanges("t", "busy");
  expect(result).toMatchObject({
    state: "unavailable",
    reason: "Too many turn changes reads. Try again shortly.",
  });
  expect(getSummary).toHaveBeenCalledTimes(3);
  expect(isRetryableTurnChangesReason(result.reason)).toBe(true);
});
it("caches backend unsupported workspaces so a non-git root is probed once per turn", async () => {
  const lease = {};
  const getSummary = vi.fn(async (): Promise<unknown> => ({
    turnId: "old",
    state: "unsupported",
    files: [],
    truncated: false,
    reason: "notGitRepository",
  }));
  const reader = readerFor(() => ({
    lease,
    identity: "owner",
    getSummary: getSummary as () => Promise<AgentTurnChangeSummary>,
    getFileDiff: async () => diff,
  }));
  expect(await reader.getTurnChanges("t", "old")).toMatchObject({
    state: "unsupported",
    reason: "notGitRepository",
  });
  expect(await reader.getTurnChanges("t", "old")).toMatchObject({ state: "unsupported" });
  expect(getSummary).toHaveBeenCalledOnce();
  await expect(reader.getTurnFileDiff("t", "old", "src/a.ts")).rejects.toThrow();
  expect(isRetryableTurnChangesReason("notGitRepository")).toBe(false);
});
