import { expect, it } from "vitest";
import type { RemoteRunnerEvent } from "../domain/remoteRunner";
import { retainRemoteReplayWindow } from "./remoteAgentReplayWindow";
const event = (
  sequence: number,
  text: string,
  channel: "stdout" | "stderr" = "stdout",
): RemoteRunnerEvent => ({
  taskId: "task",
  sequence,
  type: "task.output",
  channel,
  text,
  createdAt: "date",
});
it("tracks the last evicted stdout boundary independently of stderr", () => {
  const events = [event(1, "torn"), event(2, "error\n", "stderr"), event(3, "tail\nfinal\n")];
  const window = retainRemoteReplayWindow(events, 22);
  expect(window.events).toEqual([events[2]]);
  expect(window.gap).toEqual({ throughSequence: 2, startsAtLineBoundary: false });
});
it("keeps array identity below the cap and tracks a full eviction independently of its cursor", () => {
  const events = [event(1, "complete\n")];
  expect(retainRemoteReplayWindow(events, 100).events).toBe(events);
  expect(retainRemoteReplayWindow(events, 0)).toEqual({
    events: [],
    truncated: true,
    gap: { throughSequence: 1, startsAtLineBoundary: true },
  });
});
