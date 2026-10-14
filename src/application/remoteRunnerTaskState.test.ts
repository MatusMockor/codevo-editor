import { describe, expect, it } from "vitest";
import type { RemoteRunnerTask } from "../domain/remoteRunner";
import {
  acceptsRemoteTaskUpdate,
  isRemoteTaskDetailOf,
  mergeRemoteTasks,
  supersedeRemoteTask,
} from "./remoteRunnerTaskState";

const task = (
  id: string,
  sequence: number,
  status: RemoteRunnerTask["status"],
): RemoteRunnerTask => ({
  id,
  sequence,
  status,
  runnerId: "runner",
  provider: "codex",
  createdAt: "2026-09-13T00:00:00Z",
  parts: [],
});

describe("mergeRemoteTasks", () => {
  it.each(["running", "succeeded"] as const)("rejects mode mutation for %s tasks", (status) => {
    const original = task("one", 1, status);
    expect(() => mergeRemoteTasks([original], [{ ...original, isolation: "in-place" }])).toThrow(
      "isolation",
    );
    expect(() =>
      mergeRemoteTasks([original], [{ ...original, isolation: "worktree" }]),
    ).not.toThrow();
  });
  it("accepts refresh progress for unselected tasks and retains tasks missing from older pages", () => {
    expect(
      mergeRemoteTasks(
        [task("older", 1, "queued"), task("newer", 2, "running")],
        [task("older", 1, "succeeded")],
      ),
    ).toEqual([task("newer", 2, "running"), task("older", 1, "succeeded")]);
  });
  it("does not regress a completed or running task when older pages settle later", () => {
    const previous = [task("one", 1, "succeeded"), task("two", 2, "running")];
    expect(
      mergeRemoteTasks(previous, [task("one", 1, "running"), task("two", 2, "queued")]),
    ).toEqual([...previous].reverse());
  });
});

const at = (
  status: RemoteRunnerTask["status"],
  facts: Pick<RemoteRunnerTask, "interactionSequence" | "awaiting"> = {},
): RemoteRunnerTask => ({ ...task("one", 1, status), ...facts });

function mergedOne(stored: RemoteRunnerTask, incoming: RemoteRunnerTask): RemoteRunnerTask {
  const merged = mergeRemoteTasks([stored], [incoming]);
  expect(merged).toHaveLength(1);
  return merged[0] ?? stored;
}

describe("mergeRemoteTasks interaction freshness", () => {
  it("keeps a freshly loaded record when a cached copy with a lower sequence arrives", () => {
    const fresh = at("running", { interactionSequence: 4, awaiting: "approval" });
    const cached = at("running", { interactionSequence: 3 });

    expect(mergedOne(fresh, cached)).toBe(fresh);
    expect(acceptsRemoteTaskUpdate(fresh, cached)).toBe(false);
  });

  it("takes a cached record with a higher sequence over a load that arrives late", () => {
    const lateLoad = at("running", { interactionSequence: 3, awaiting: "approval" });
    const cached = at("running", { interactionSequence: 4 });

    expect(mergedOne(lateLoad, cached)).toBe(cached);
    expect(acceptsRemoteTaskUpdate(lateLoad, cached)).toBe(true);
  });

  it("takes the incoming record at an equal sequence, as before", () => {
    const stored = at("running", { interactionSequence: 3 });
    const incoming = at("running", { interactionSequence: 3 });

    expect(mergedOne(stored, incoming)).toBe(incoming);
  });

  it.each(["draft", "queued", "running"] as const)(
    "takes the incoming %s record when neither side reports a sequence, as before",
    (status) => {
      const stored = at(status);
      const incoming = at(status);

      expect(mergedOne(stored, incoming)).toBe(incoming);
      expect(acceptsRemoteTaskUpdate(stored, incoming)).toBe(true);
    },
  );

  it("keeps the sequence and the awaited approval when a copy without them arrives", () => {
    const stored = at("running", { interactionSequence: 3, awaiting: "approval" });
    const withoutFacts = at("running");

    expect(mergedOne(stored, withoutFacts)).toBe(stored);
    expect(acceptsRemoteTaskUpdate(stored, withoutFacts)).toBe(false);
  });

  it("takes a first reported sequence over a record that has none", () => {
    const stored = at("running");
    const incoming = at("running", { interactionSequence: 0 });

    expect(mergedOne(stored, incoming)).toBe(incoming);
  });

  it("clears the awaited approval when the sequence moves on", () => {
    const stored = at("running", { interactionSequence: 3, awaiting: "approval" });
    const incoming = at("running", { interactionSequence: 4 });

    expect(mergedOne(stored, incoming).awaiting).toBeUndefined();
  });

  it.each([
    ["a lower sequence", { interactionSequence: 1 }],
    ["no sequence", {}],
  ] as const)(
    "takes a rising status that reports %s and keeps the stored sequence",
    (_label, facts) => {
      const stored = at("running", { interactionSequence: 5, awaiting: "approval" });
      const incoming: RemoteRunnerTask = {
        ...at("succeeded", facts),
        parts: [{ type: "text", text: "Canonical prompt" }],
      };

      const merged = mergedOne(stored, incoming);

      expect(merged).toEqual({ ...incoming, interactionSequence: 5 });
      expect(merged.parts).toBe(incoming.parts);
      expect("awaiting" in merged).toBe(false);
      expect(acceptsRemoteTaskUpdate(stored, incoming)).toBe(true);
    },
  );

  it("takes a rising status with a higher sequence as it is", () => {
    const stored = at("running", { interactionSequence: 5, awaiting: "approval" });
    const incoming = at("succeeded", { interactionSequence: 6 });

    expect(mergedOne(stored, incoming)).toBe(incoming);
  });

  it("keeps the sequence and the awaited approval when a turn without them starts running", () => {
    const stored = at("queued", { interactionSequence: 2, awaiting: "approval" });
    const incoming = at("running");

    expect(mergedOne(stored, incoming)).toEqual({
      ...incoming,
      interactionSequence: 2,
      awaiting: "approval",
    });
  });

  it("takes a rising status of an old runner as it is, as before", () => {
    const stored = at("running");
    const incoming = at("succeeded");

    expect(mergedOne(stored, incoming)).toBe(incoming);
  });

  it("keeps a running record over a queued copy with a higher sequence", () => {
    const stored = at("running", { interactionSequence: 2 });
    const incoming = at("queued", { interactionSequence: 9 });

    expect(mergedOne(stored, incoming)).toBe(stored);
  });

  it("does not let any sequence change the isolation rule", () => {
    const stored = at("running", { interactionSequence: 2 });
    const incoming: RemoteRunnerTask = { ...stored, interactionSequence: 3, isolation: "in-place" };

    expect(acceptsRemoteTaskUpdate(stored, incoming)).toBe(false);
    expect(() => mergeRemoteTasks([stored], [incoming])).toThrow("isolation");
  });
});

describe("mergeRemoteTasks settlement after the turn ended", () => {
  it("carries a moved sequence onto the frozen terminal record", () => {
    const frozen: RemoteRunnerTask = {
      ...at("succeeded", { interactionSequence: 4, awaiting: "approval" }),
      parts: [{ type: "text", text: "Canonical prompt" }],
    };
    const settled: RemoteRunnerTask = {
      ...at("succeeded", { interactionSequence: 5 }),
      parts: [{ type: "text", text: "Abbreviated" }],
    };

    const merged = mergedOne(frozen, settled);

    expect(merged).toEqual({ ...frozen, interactionSequence: 5, awaiting: undefined });
    expect(merged.parts).toBe(frozen.parts);
    expect("awaiting" in merged).toBe(false);
    expect(acceptsRemoteTaskUpdate(frozen, settled)).toBe(true);
  });

  it("gives a terminal record that had no sequence its first one", () => {
    const frozen = at("interrupted");
    const reported = at("interrupted", { interactionSequence: 2 });

    expect(mergedOne(frozen, reported)).toEqual(reported);
  });

  it("keeps the same terminal record once the moved sequence is stored", () => {
    const frozen = at("succeeded", { interactionSequence: 4 });
    const settled = at("succeeded", { interactionSequence: 5 });
    const first = mergedOne(frozen, settled);

    expect(mergedOne(first, settled)).toBe(first);
    expect(mergedOne(first, structuredClone(settled))).toBe(first);
  });

  it.each([
    ["an equal sequence", { interactionSequence: 4 }],
    ["a lower sequence", { interactionSequence: 3 }],
    ["no sequence", {}],
  ] as const)("stays frozen for the same terminal status with %s", (_label, facts) => {
    const frozen = at("succeeded", { interactionSequence: 4 });
    const incoming = at("succeeded", facts);

    expect(mergedOne(frozen, incoming)).toBe(frozen);
    expect(acceptsRemoteTaskUpdate(frozen, incoming)).toBe(false);
  });

  it("stays frozen when neither terminal record reports a sequence, as before", () => {
    const frozen = at("succeeded");

    expect(mergedOne(frozen, at("succeeded"))).toBe(frozen);
    expect(acceptsRemoteTaskUpdate(frozen, at("succeeded"))).toBe(false);
  });

  it.each(["failed", "running", "queued"] as const)(
    "stays frozen when a higher sequence comes with the other status %s",
    (status) => {
      const frozen = at("succeeded", { interactionSequence: 4 });
      const incoming = at(status, { interactionSequence: 9 });

      expect(mergedOne(frozen, incoming)).toBe(frozen);
      expect(acceptsRemoteTaskUpdate(frozen, incoming)).toBe(false);
    },
  );
});

describe("isRemoteTaskDetailOf", () => {
  const listed: RemoteRunnerTask = {
    ...at("running", { interactionSequence: 4, awaiting: "approval" }),
    projectId: "project",
    conversationId: "root",
    parentTaskId: "root",
  };

  it.each([
    ["no sequence", { interactionSequence: undefined, awaiting: undefined }],
    ["a lower sequence", { interactionSequence: 1, awaiting: undefined }],
    ["a higher sequence", { interactionSequence: 9 }],
    ["a later status", { status: "succeeded" as const, interactionSequence: undefined }],
    ["other parts", { parts: [{ type: "text" as const, text: "Canonical prompt" }] }],
  ])("accepts the same turn with %s", (_label, change) => {
    expect(isRemoteTaskDetailOf(listed, { ...listed, ...change })).toBe(true);
  });

  it.each([
    ["another id", { id: "two" }],
    ["another runner", { runnerId: "other" }],
    ["another provider", { provider: "claude" as const }],
    ["another isolation", { isolation: "in-place" as const }],
    ["another task sequence", { sequence: 2 }],
    ["another creation time", { createdAt: "2026-09-14T00:00:00Z" }],
    ["another project", { projectId: "other" }],
    ["another conversation", { conversationId: "elsewhere" }],
    ["another parent", { parentTaskId: "elsewhere" }],
    ["an earlier status", { status: "queued" as const }],
  ])("rejects %s even with a higher sequence", (_label, change) => {
    expect(isRemoteTaskDetailOf(listed, { ...listed, ...change, interactionSequence: 9 })).toBe(
      false,
    );
  });

  it("treats a missing conversation id as the task's own id", () => {
    const root = at("succeeded");

    expect(isRemoteTaskDetailOf(root, { ...root, conversationId: "one" })).toBe(true);
    expect(isRemoteTaskDetailOf(root, { ...root, conversationId: "two" })).toBe(false);
  });

  it("holds a finished turn to its exact status whatever the sequence", () => {
    const finished = at("succeeded", { interactionSequence: 4 });

    expect(isRemoteTaskDetailOf(finished, at("succeeded"))).toBe(true);
    expect(isRemoteTaskDetailOf(finished, at("succeeded", { interactionSequence: 9 }))).toBe(true);
    expect(isRemoteTaskDetailOf(finished, at("failed", { interactionSequence: 9 }))).toBe(false);
    expect(isRemoteTaskDetailOf(finished, at("running", { interactionSequence: 9 }))).toBe(false);
  });
});

describe("supersedeRemoteTask", () => {
  const canonical = [{ type: "text" as const, text: "Canonical prompt" }];

  it("returns the detail itself when it reports the same or a higher sequence", () => {
    const listed = at("running", { interactionSequence: 4, awaiting: "approval" });
    const same: RemoteRunnerTask = {
      ...at("running", { interactionSequence: 4 }),
      parts: canonical,
    };
    const higher = at("running", { interactionSequence: 5 });

    expect(supersedeRemoteTask(listed, same)).toBe(same);
    expect(supersedeRemoteTask(listed, higher)).toBe(higher);
  });

  it("returns the detail itself when neither record reports a sequence", () => {
    const detail: RemoteRunnerTask = { ...at("running"), parts: canonical };

    expect(supersedeRemoteTask(at("running"), detail)).toBe(detail);
  });

  it.each([
    ["no sequence", {}],
    ["a lower sequence", { interactionSequence: 3 }],
  ] as const)("keeps the listed facts on the content of a detail with %s", (_label, facts) => {
    const listed = at("running", { interactionSequence: 4, awaiting: "approval" });
    const detail: RemoteRunnerTask = { ...at("running", facts), parts: canonical };

    const hydrated = supersedeRemoteTask(listed, detail);

    expect(hydrated).toEqual({ ...detail, interactionSequence: 4, awaiting: "approval" });
    expect(hydrated.parts).toBe(canonical);
  });

  it("does not carry an awaited approval onto a detail that has ended", () => {
    const listed = at("running", { interactionSequence: 4, awaiting: "approval" });
    const detail: RemoteRunnerTask = { ...at("succeeded"), parts: canonical };

    const hydrated = supersedeRemoteTask(listed, detail);

    expect(hydrated).toEqual({ ...detail, interactionSequence: 4 });
    expect("awaiting" in hydrated).toBe(false);
  });
});
