import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RemoteRunnerSurfacesGateway,
  RemoteTerminalOutput,
  RemoteTerminalSnapshot,
} from "../domain/remoteRunnerSurfaces";
import { createRemoteTerminalSession } from "./remoteTerminalSession";
const scope = {
  serverId: "server-a",
  runnerId: "runner-a",
  projectId: "project-a",
  taskId: "task-a",
};
const snapshot: RemoteTerminalSnapshot = {
  id: "pty-a",
  projectId: scope.projectId,
  taskId: scope.taskId,
  cols: 80,
  rows: 24,
  status: "running",
  exitCode: null,
  sequence: 0,
};
function setup() {
  const gateway = {
    openTerminal: vi.fn().mockResolvedValue(snapshot),
    pollTerminal: vi.fn().mockResolvedValue({ ...snapshot, chunks: [], truncated: false }),
    writeTerminal: vi.fn().mockResolvedValue({ accepted: true }),
    resizeTerminal: vi.fn().mockResolvedValue(snapshot),
    closeTerminal: vi.fn().mockResolvedValue({ closed: true }),
  };
  const writeOutput = vi.fn().mockResolvedValue(undefined);
  const onState = vi.fn();
  return {
    gateway,
    writeOutput,
    onState,
    start: () =>
      createRemoteTerminalSession({
        gateway: gateway as unknown as RemoteRunnerSurfacesGateway,
        scope,
        size: { cols: 80, rows: 24 },
        writeOutput,
        onState,
      }),
  };
}
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());
describe("remote terminal ownership", () => {
  it("does not close the server PTY or render a late open after detaching", async () => {
    const test = setup();
    let resolve!: (value: RemoteTerminalSnapshot) => void;
    test.gateway.openTerminal.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const session = test.start();
    session.dispose();
    resolve(snapshot);
    await settle();
    expect(test.gateway.pollTerminal).not.toHaveBeenCalled();
    expect(test.gateway.closeTerminal).not.toHaveBeenCalled();
    expect(test.onState).toHaveBeenCalledTimes(1);
  });
  it("ignores late output and stale input after switching A to B", async () => {
    const test = setup();
    let resolve!: (value: RemoteTerminalOutput) => void;
    test.gateway.pollTerminal.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const session = test.start();
    await settle();
    test.gateway.resizeTerminal.mockClear();
    session.dispose();
    session.write("danger\n");
    session.resize({ cols: 120, rows: 30 });
    resolve({
      ...snapshot,
      sequence: 1,
      chunks: [{ sequence: 1, data: "foreign" }],
      truncated: false,
    });
    await settle();
    expect(test.writeOutput).not.toHaveBeenCalled();
    expect(test.gateway.writeTerminal).not.toHaveBeenCalled();
    expect(test.gateway.resizeTerminal).not.toHaveBeenCalled();
  });
  it("reconnects with the same session and replays only unseen chunks", async () => {
    vi.useFakeTimers();
    const test = setup();
    test.gateway.pollTerminal
      .mockResolvedValueOnce({
        ...snapshot,
        sequence: 1,
        chunks: [{ sequence: 1, data: "one" }],
        truncated: false,
      })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        ...snapshot,
        sequence: 2,
        chunks: [
          { sequence: 1, data: "one" },
          { sequence: 2, data: "two" },
        ],
        truncated: false,
      });
    const session = test.start();
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(test.gateway.openTerminal).toHaveBeenCalledTimes(1);
    expect(test.gateway.pollTerminal).toHaveBeenLastCalledWith({
      ...scope,
      terminalId: snapshot.id,
      after: 1,
    });
    expect(test.writeOutput.mock.calls.map(([data]) => data)).toEqual(["one", "two"]);
    session.dispose();
  });
  it("reports bounded replay loss and drains output before shell exit", async () => {
    vi.useFakeTimers();
    const test = setup();
    test.gateway.pollTerminal
      .mockResolvedValueOnce({
        ...snapshot,
        status: "exited",
        sequence: 9,
        chunks: [{ sequence: 8, data: "eight" }],
        truncated: true,
      })
      .mockResolvedValueOnce({
        ...snapshot,
        status: "exited",
        exitCode: 2,
        sequence: 9,
        chunks: [{ sequence: 9, data: "nine" }],
        truncated: false,
      });
    const session = test.start();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.writeOutput.mock.calls.map(([data]) => data)).toEqual([
      "\r\n[Earlier terminal output is no longer available.]\r\n",
      "eight",
      "nine",
    ]);
    expect(test.onState).toHaveBeenLastCalledWith({ kind: "exited", exitCode: 2 });
    session.dispose();
  });
  it("refuses foreign checkout sessions", async () => {
    const test = setup();
    test.gateway.openTerminal.mockResolvedValue({ ...snapshot, taskId: "other" });
    const session = test.start();
    await settle();
    expect(test.gateway.pollTerminal).not.toHaveBeenCalled();
    expect(test.onState).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "error" }));
    session.dispose();
  });
  it("serializes input, drops pending input on detach and never retries uncertain writes", async () => {
    const test = setup();
    let reject!: (reason: Error) => void;
    test.gateway.writeTerminal.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const session = test.start();
    await settle();
    session.write("first");
    session.write("second");
    await settle();
    expect(test.gateway.writeTerminal).toHaveBeenCalledTimes(1);
    session.dispose();
    reject(new Error("offline"));
    await settle();
    expect(test.gateway.writeTerminal).toHaveBeenCalledTimes(1);
  });
  it("bounds UTF-8 input and preserves an uncertain input warning across output polls", async () => {
    vi.useFakeTimers();
    const test = setup();
    const session = test.start();
    await settle();
    session.write("é".repeat(40_000));
    await settle();
    expect(test.gateway.writeTerminal).not.toHaveBeenCalled();
    expect(test.onState).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "error" }));
    test.gateway.writeTerminal.mockRejectedValueOnce(new Error("offline"));
    session.write("first");
    session.write("second");
    await settle();
    expect(test.gateway.writeTerminal).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(test.onState).toHaveBeenLastCalledWith({
      kind: "error",
      message: "Terminal input could not be confirmed. It was not sent again.",
    });
    session.dispose();
  });
  it("coalesces resize requests while a resize is in flight", async () => {
    const test = setup();
    let resolve!: (value: RemoteTerminalSnapshot) => void;
    test.gateway.resizeTerminal.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const session = test.start();
    await settle();
    session.resize({ cols: 90, rows: 30 });
    session.resize({ cols: 110, rows: 40 });
    expect(test.gateway.resizeTerminal).toHaveBeenCalledTimes(1);
    resolve(snapshot);
    await settle();
    expect(test.gateway.resizeTerminal).toHaveBeenCalledTimes(2);
    expect(test.gateway.resizeTerminal).toHaveBeenLastCalledWith({
      ...scope,
      terminalId: snapshot.id,
      cols: 110,
      rows: 40,
    });
    session.dispose();
  });
  it("invalidates an in-flight poll when close fails without duplicating replay", async () => {
    vi.useFakeTimers();
    const test = setup();
    let resolve!: (value: RemoteTerminalOutput) => void;
    test.gateway.pollTerminal.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    test.gateway.closeTerminal.mockRejectedValueOnce(new Error("offline"));
    const session = test.start();
    await settle();
    await session.close();
    resolve({ ...snapshot, sequence: 1, chunks: [{ sequence: 1, data: "old" }], truncated: false });
    await settle();
    expect(test.writeOutput).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(test.gateway.pollTerminal).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it("does not replay output already handed to xterm when close fails during rendering", async () => {
    vi.useFakeTimers();
    const test = setup();
    let rendered!: () => void;
    test.writeOutput.mockReturnValueOnce(
      new Promise<void>((done) => {
        rendered = done;
      }),
    );
    test.gateway.pollTerminal.mockResolvedValueOnce({
      ...snapshot,
      sequence: 1,
      chunks: [{ sequence: 1, data: "shown" }],
      truncated: false,
    });
    test.gateway.closeTerminal.mockRejectedValueOnce(new Error("offline"));
    const session = test.start();
    await settle();
    await session.close();
    rendered();
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(test.gateway.pollTerminal).toHaveBeenLastCalledWith({
      ...scope,
      terminalId: snapshot.id,
      after: 1,
    });
    expect(test.writeOutput).toHaveBeenCalledTimes(1);
    session.dispose();
  });
  it("closes only after explicit user action", async () => {
    const test = setup();
    const session = test.start();
    await settle();
    await session.close();
    expect(test.gateway.closeTerminal).toHaveBeenCalledWith({ ...scope, terminalId: snapshot.id });
    expect(test.onState).toHaveBeenLastCalledWith({ kind: "closed" });
    session.dispose();
  });
});
