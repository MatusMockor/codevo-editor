import { describe, expect, it } from "vitest";
import type { RemoteRunnerTask } from "../domain/remoteRunner";
import { mergeRemoteTasks } from "./remoteRunnerTaskState";

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
