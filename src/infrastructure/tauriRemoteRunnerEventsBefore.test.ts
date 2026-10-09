import { describe, expect, it, vi } from "vitest";
import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { REMOTE_RUNNER_COMMANDS, TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const TASK = "12345678-1234-4234-8234-123456789abc";
const OTHER = "87654321-4321-4234-8234-cba987654321";

function event(sequence: number, taskId = TASK) {
  return {
    sequence,
    taskId,
    type: "task.output",
    createdAt: "2026-09-13T00:00:00.000Z",
    channel: "stdout",
    text: `chunk ${sequence}`,
  };
}

const request = { serverId: "linux", taskId: TASK, before: 40 };

describe("TauriRemoteRunnerGateway backward event paging", () => {
  it("invokes the existing list-events command with exactly the before cursor", async () => {
    const page = { items: [event(7), event(39)], nextCursor: 7 };
    const invoke = vi.fn().mockResolvedValue(page);

    expect(await new TauriRemoteRunnerGateway(invoke).listEventsBefore(request)).toEqual(page);
    expect(REMOTE_RUNNER_COMMANDS.listEventsBefore).toBe(REMOTE_RUNNER_COMMANDS.listEvents);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("remote_runner_list_events", {
      request: { serverId: "linux", taskId: TASK, before: 40 },
    });
  });

  it("keeps the forward request shape unchanged", async () => {
    const invoke = vi.fn().mockResolvedValue({ items: [], nextCursor: null });

    await new TauriRemoteRunnerGateway(invoke).listEvents({
      serverId: "linux",
      taskId: TASK,
      after: 0,
    });

    expect(invoke).toHaveBeenCalledWith("remote_runner_list_events", {
      request: { serverId: "linux", taskId: TASK, after: 0 },
    });
  });

  it.each([{ before: 0 }, { before: 1.5 }, { before: 40, after: 0 }])(
    "rejects request %j before any IPC call",
    async (fields) => {
      const invoke = vi.fn();
      const invalid = { serverId: "linux", taskId: TASK, ...fields };
      const outcome = await new TauriRemoteRunnerGateway(invoke)
        .listEventsBefore(invalid)
        .catch((error: unknown) => error);

      expect(isRemoteRunnerRequestRejectedError(outcome)).toBe(true);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["an unknown field", { items: [event(7)], nextCursor: null, direction: "before" }],
    ["a descending page", { items: [event(39), event(7)], nextCursor: null }],
    ["an event of another task", { items: [event(7, OTHER)], nextCursor: null }],
    ["an event at the cursor", { items: [event(7), event(40)], nextCursor: null }],
    ["a cursor that is not the oldest event", { items: [event(7), event(39)], nextCursor: 39 }],
    ["a cursor on an empty page", { items: [], nextCursor: 7 }],
  ])("rejects a response with %s", async (_name, response) => {
    const invoke = vi.fn().mockResolvedValue(response);

    await expect(new TauriRemoteRunnerGateway(invoke).listEventsBefore(request)).rejects.toThrow(
      /Invalid remote runner/,
    );
  });
});
