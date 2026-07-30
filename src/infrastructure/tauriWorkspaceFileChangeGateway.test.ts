import { describe, expect, it, vi } from "vitest";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import { TauriWorkspaceFileChangeGateway } from "./tauriWorkspaceFileChangeGateway";

type WireChange = WorkspaceFileChangeEvent & { watchGeneration: number };

const wireChange = (
  rootPath: string,
  watchGeneration: number,
  kind: WorkspaceFileChangeEvent["kind"] = "modified",
): WireChange => ({
  watchGeneration,
  rootPath,
  kind,
  path: rootPath,
  previousPath: null,
  relativePath: "",
  previousRelativePath: null,
  fileKind: "directory",
});

const change = (
  rootPath: string,
  kind: WorkspaceFileChangeEvent["kind"] = "modified",
): WorkspaceFileChangeEvent => ({
  rootPath,
  kind,
  path: rootPath,
  previousPath: null,
  relativePath: "",
  previousRelativePath: null,
  fileKind: "directory",
});

describe("TauriWorkspaceFileChangeGateway generation fencing", () => {
  it("listens before starting and replays an initial event to a later subscriber", async () => {
    let resolveStart:
      ((receipt: { rootPath: string; watchGeneration: number }) => void) | undefined;
    const invoke = vi.fn(
      () =>
        new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );

    const starting = gateway.startWatching("/alias/a");
    await vi.waitFor(() => expect(resolveStart).toBeTypeOf("function"));
    emit?.({ payload: wireChange("/canonical/a", 4) });
    resolveStart?.({ rootPath: "/canonical/a", watchGeneration: 4 });
    await starting;
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));

    expect(received).toEqual([change("/alias/a", "rescanRequired")]);
  });

  it("rolls back a subscriber that throws during listener-gap recovery", async () => {
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      vi.fn().mockResolvedValue({
        rootPath: "/canonical/a",
        watchGeneration: 3,
      }),
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    await gateway.startWatching("/alias/a");
    emit?.({ payload: wireChange("/canonical/a", 3) });

    await expect(
      gateway.subscribeFileChanges(() => {
        throw new Error("disposed");
      }),
    ).rejects.toThrow("disposed");
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));

    expect(received).toEqual([change("/alias/a", "rescanRequired")]);
  });

  it("buffers the exact initial generation until the canonical start receipt arrives", async () => {
    let resolveStart:
      ((receipt: { rootPath: string; watchGeneration: number }) => void) | undefined;
    const invoke = vi.fn(
      () =>
        new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];

    await gateway.subscribeFileChanges((event) => received.push(event));
    const starting = gateway.startWatching("/alias/a");
    await vi.waitFor(() => expect(resolveStart).toBeTypeOf("function"));
    emit?.({ payload: wireChange("/canonical/a", 4, "rescanRequired") });
    expect(received).toEqual([]);

    resolveStart?.({ rootPath: "/canonical/a", watchGeneration: 4 });
    await starting;

    expect(received).toEqual([change("/alias/a", "rescanRequired")]);
  });

  it("escalates a pre-receipt buffer overflow to a truthful rescan", async () => {
    let resolveStart:
      ((receipt: { rootPath: string; watchGeneration: number }) => void) | undefined;
    const invoke = vi.fn(
      () =>
        new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));

    const starting = gateway.startWatching("/alias/a");
    await vi.waitFor(() => expect(resolveStart).toBeTypeOf("function"));
    for (let index = 0; index < 129; index += 1) {
      emit?.({
        payload: {
          ...wireChange("/canonical/a", 6),
          path: `/canonical/a/${index}.ts`,
          relativePath: `${index}.ts`,
        },
      });
    }
    resolveStart?.({ rootPath: "/canonical/a", watchGeneration: 6 });
    await starting;

    expect(received.some((event) => event.kind === "rescanRequired")).toBe(true);
  });

  it("coalesces duplicate pre-receipt events without declaring overflow", async () => {
    let resolveStart:
      ((receipt: { rootPath: string; watchGeneration: number }) => void) | undefined;
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      vi.fn(
        () =>
          new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
            resolveStart = resolve;
          }),
      ),
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));

    const starting = gateway.startWatching("/alias/a");
    await vi.waitFor(() => expect(resolveStart).toBeTypeOf("function"));
    for (let index = 0; index < 129; index += 1) {
      emit?.({ payload: wireChange("/canonical/a", 6) });
    }
    resolveStart?.({ rootPath: "/canonical/a", watchGeneration: 6 });
    await starting;

    expect(received).toEqual([change("/alias/a")]);
  });

  it("attributes a pre-receipt overflow to the root whose event was dropped", async () => {
    const resolvers: Array<(receipt: { rootPath: string; watchGeneration: number }) => void> = [];
    const invoke = vi.fn(
      () =>
        new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));

    const startingB = gateway.startWatching("/alias/b");
    const startingA = gateway.startWatching("/alias/a");
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    for (let index = 0; index < 128; index += 1) {
      emit?.({
        payload: {
          ...wireChange("/canonical/b", 2),
          path: `/canonical/b/${index}.ts`,
          relativePath: `${index}.ts`,
        },
      });
    }
    emit?.({ payload: wireChange("/canonical/a", 1) });

    resolvers[1]?.({ rootPath: "/canonical/a", watchGeneration: 1 });
    await startingA;
    expect(
      received.some((event) => event.rootPath === "/alias/a" && event.kind === "rescanRequired"),
    ).toBe(false);

    resolvers[0]?.({ rootPath: "/canonical/b", watchGeneration: 2 });
    await startingB;
    expect(
      received.some((event) => event.rootPath === "/alias/b" && event.kind === "rescanRequired"),
    ).toBe(true);
  });

  it("rejects delayed A1 after A3 is admitted and still forwards current rescans", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ rootPath: "/canonical/a", watchGeneration: 1 })
      .mockResolvedValueOnce({ rootPath: "/canonical/b", watchGeneration: 2 })
      .mockResolvedValueOnce({ rootPath: "/canonical/a", watchGeneration: 3 });
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const listen = vi.fn(async (_event, handler) => {
      emit = handler;
      return () => undefined;
    });
    const gateway = new TauriWorkspaceFileChangeGateway(invoke, listen, () => true);
    const received: WorkspaceFileChangeEvent[] = [];

    await gateway.subscribeFileChanges((event) => received.push(event));
    await gateway.startWatching("/alias/a");
    await gateway.startWatching("/alias/b");
    await gateway.startWatching("/alias/a");

    emit?.({ payload: wireChange("/canonical/a", 1) });
    emit?.({ payload: wireChange("/canonical/b", 2) });
    emit?.({ payload: wireChange("/canonical/a", 3, "rescanRequired") });

    expect(received).toEqual([change("/alias/b"), change("/alias/a", "rescanRequired")]);
  });

  it("revokes the admitted generation when a replacement start fails", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ rootPath: "/canonical/a", watchGeneration: 7 })
      .mockRejectedValueOnce(new Error("watch failed"));
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];

    await gateway.subscribeFileChanges((event) => received.push(event));
    await gateway.startWatching("/alias/a");
    await expect(gateway.startWatching("/alias/a")).rejects.toThrow("watch failed");
    emit?.({ payload: wireChange("/canonical/a", 7) });

    expect(received).toEqual([]);
  });

  it("rejects malformed wire values before they reach the domain", async () => {
    const invoke = vi.fn().mockResolvedValue({
      rootPath: "/canonical/a",
      watchGeneration: 5,
    });
    let emit: ((event: { payload: unknown }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];

    await gateway.subscribeFileChanges((event) => received.push(event));
    await gateway.startWatching("/alias/a");
    emit?.({ payload: { ...wireChange("/canonical/a", 5), kind: "unknown" } });
    emit?.({ payload: { ...wireChange("/canonical/a", 5), unexpected: true } });
    emit?.({ payload: { ...wireChange("/canonical/a", 5), watchGeneration: 1.5 } });
    emit?.({ payload: { ...wireChange("/canonical/a", 5), previousPath: undefined } });
    emit?.({
      payload: {
        ...wireChange("/canonical/a", 5),
        path: "x".repeat(32_769),
      },
    });
    emit?.({
      payload: {
        ...wireChange("/canonical/a", 5),
        path: "/outside/secret.ts",
        relativePath: "../outside/secret.ts",
      },
    });
    emit?.({ payload: wireChange("/canonical/a", 5) });

    expect(received).toEqual([change("/alias/a")]);
  });

  it("rejects unknown and oversized UTF-8 start receipt fields", async () => {
    const listen = vi.fn(async () => () => undefined);
    const unknownKeyGateway = new TauriWorkspaceFileChangeGateway(
      vi.fn().mockResolvedValue({
        rootPath: "/canonical/a",
        watchGeneration: 1,
        unexpected: true,
      }),
      listen,
      () => true,
    );
    await expect(unknownKeyGateway.startWatching("/alias/a")).rejects.toThrow(
      "invalid start receipt",
    );

    const oversizedGateway = new TauriWorkspaceFileChangeGateway(
      vi.fn().mockResolvedValue({
        rootPath: `/${"é".repeat(16_384)}`,
        watchGeneration: 1,
      }),
      listen,
      () => true,
    );
    await expect(oversizedGateway.startWatching("/alias/a")).rejects.toThrow(
      "invalid start receipt",
    );

    const exactBoundaryRoot = `/${"é".repeat(16_383)}a`;
    const exactBoundaryGateway = new TauriWorkspaceFileChangeGateway(
      vi.fn().mockResolvedValue({
        rootPath: exactBoundaryRoot,
        watchGeneration: 2,
      }),
      listen,
      () => true,
    );
    await expect(exactBoundaryGateway.startWatching("/alias/exact")).resolves.toBeUndefined();
  });

  it("removes a subscriber when transport registration fails", async () => {
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const listen = vi
      .fn()
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockImplementationOnce(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      });
    const gateway = new TauriWorkspaceFileChangeGateway(
      vi.fn().mockResolvedValue({
        rootPath: "/canonical/a",
        watchGeneration: 5,
      }),
      listen,
      () => true,
    );
    const rejectedListener = vi.fn();

    await expect(gateway.subscribeFileChanges(rejectedListener)).rejects.toThrow("listen failed");
    await gateway.startWatching("/alias/a");
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));
    emit?.({ payload: wireChange("/canonical/a", 5) });

    expect(rejectedListener).not.toHaveBeenCalled();
    expect(received).toEqual([change("/alias/a")]);
  });

  it("keeps a shared canonical generation admitted when one alias restart fails", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ rootPath: "/canonical/shared", watchGeneration: 7 })
      .mockResolvedValueOnce({ rootPath: "/canonical/shared", watchGeneration: 7 })
      .mockRejectedValueOnce(new Error("replacement failed"));
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));
    await gateway.startWatching("/alias/one");
    await gateway.startWatching("/alias/two");

    await expect(gateway.startWatching("/alias/one")).rejects.toThrow("replacement failed");
    emit?.({ payload: wireChange("/canonical/shared", 7) });

    expect(received).toEqual([change("/alias/two")]);
  });

  it("isolates a throwing subscriber from later listeners", async () => {
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      vi.fn().mockResolvedValue({
        rootPath: "/canonical/a",
        watchGeneration: 5,
      }),
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    await gateway.startWatching("/alias/a");
    const throwingListener = vi.fn(() => {
      throw new Error("listener failed");
    });
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges(throwingListener);
    await gateway.subscribeFileChanges((event) => received.push(event));

    emit?.({ payload: wireChange("/canonical/a", 5) });
    emit?.({ payload: wireChange("/canonical/a", 5) });

    expect(throwingListener).toHaveBeenCalledTimes(1);
    expect(received).toEqual([change("/alias/a"), change("/alias/a")]);
  });

  it("accepts an exact UTF-8 event boundary and rejects the next byte", async () => {
    let emit: ((event: { payload: unknown }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      vi.fn().mockResolvedValue({
        rootPath: "/c",
        watchGeneration: 4,
      }),
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));
    await gateway.startWatching("/c");
    const exactRelativePath = `${"é".repeat(16_382)}a`;

    emit?.({
      payload: {
        ...wireChange("/c", 4),
        path: `/c/${exactRelativePath}`,
        relativePath: exactRelativePath,
        fileKind: "file",
      },
    });
    emit?.({
      payload: {
        ...wireChange("/c", 4),
        path: `/c/${exactRelativePath}a`,
        relativePath: `${exactRelativePath}a`,
        fileKind: "file",
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.path).toBe(`/c/${exactRelativePath}`);
  });

  it("does not let an older reordered start settlement overwrite newer authority", async () => {
    const resolvers: Array<(receipt: { rootPath: string; watchGeneration: number }) => void> = [];
    const invoke = vi.fn(
      () =>
        new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];

    await gateway.subscribeFileChanges((event) => received.push(event));
    const older = gateway.startWatching("/alias/a");
    const newer = gateway.startWatching("/alias/a");
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]?.({ rootPath: "/canonical/new", watchGeneration: 9 });
    await newer;
    resolvers[0]?.({ rootPath: "/canonical/old", watchGeneration: 8 });
    await older;
    emit?.({ payload: wireChange("/canonical/old", 8) });
    emit?.({ payload: wireChange("/canonical/new", 9) });

    expect(received).toEqual([change("/alias/a")]);
  });

  it("retains newer root capacity when an older same-root transport rejects late", async () => {
    const settlements: Array<{
      reject: (error: Error) => void;
      resolve: (receipt: { rootPath: string; watchGeneration: number }) => void;
    }> = [];
    const gateway = new TauriWorkspaceFileChangeGateway(
      vi.fn(
        () =>
          new Promise<{ rootPath: string; watchGeneration: number }>((resolve, reject) =>
            settlements.push({ reject, resolve }),
          ),
      ),
      vi.fn(async () => () => undefined),
      () => true,
      { maxRoots: 1 },
    );

    const older = gateway.startWatching("/a");
    const olderExpectation = expect(older).rejects.toThrow("older failed");
    const newer = gateway.startWatching("/a");
    await vi.waitFor(() => expect(settlements).toHaveLength(2));
    settlements[1]?.resolve({ rootPath: "/a", watchGeneration: 2 });
    await newer;
    settlements[0]?.reject(new Error("older failed"));
    await olderExpectation;

    await expect(gateway.startWatching("/b")).rejects.toThrow("root capacity");
  });

  it("does not let a slower alias overwrite newer canonical routing", async () => {
    const resolvers: Array<(receipt: { rootPath: string; watchGeneration: number }) => void> = [];
    const invoke = vi.fn(
      () =>
        new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));

    const aliasStart = gateway.startWatching("/symlink/project");
    const canonicalStart = gateway.startWatching("/real/project");
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]?.({ rootPath: "/real/project", watchGeneration: 12 });
    await canonicalStart;
    resolvers[0]?.({ rootPath: "/real/project", watchGeneration: 12 });
    await aliasStart;
    emit?.({ payload: wireChange("/real/project", 12) });

    expect(received).toEqual([change("/real/project")]);
  });

  it("times out transport registration and releases the start admission", async () => {
    vi.useFakeTimers();
    try {
      const gateway = new TauriWorkspaceFileChangeGateway(
        vi.fn(),
        vi.fn((): Promise<() => void> => new Promise(() => undefined)),
        () => true,
        { operationTimeoutMs: 10, maxStartsInFlight: 1 },
      );

      const first = gateway.startWatching("/a");
      const firstExpectation = expect(first).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await firstExpectation;

      const second = gateway.startWatching("/b");
      const secondExpectation = expect(second).rejects.toThrow("transport capacity");
      await secondExpectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains start transport permits after caller timeout until IPC settles", async () => {
    vi.useFakeTimers();
    try {
      const gateway = new TauriWorkspaceFileChangeGateway(
        vi.fn(() => new Promise(() => undefined)),
        vi.fn(async () => () => undefined),
        () => true,
        { operationTimeoutMs: 10, maxStartsInFlight: 1 },
      );

      const first = gateway.startWatching("/a");
      const firstExpectation = expect(first).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await firstExpectation;

      await expect(gateway.startWatching("/b")).rejects.toThrow("transport capacity");
      await gateway.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a valid late start receipt and releases its root capacity", async () => {
    vi.useFakeTimers();
    try {
      let resolveStart:
        ((receipt: { rootPath: string; watchGeneration: number }) => void) | undefined;
      const invoke = vi.fn((command: string) => {
        if (command === "start_workspace_file_watch" && !resolveStart) {
          return new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
            resolveStart = resolve;
          });
        }
        if (command === "stop_workspace_file_watch") {
          return Promise.resolve(true);
        }
        return Promise.resolve({ rootPath: "/b", watchGeneration: 2 });
      });
      const gateway = new TauriWorkspaceFileChangeGateway(
        invoke,
        vi.fn(async () => () => undefined),
        () => true,
        { operationTimeoutMs: 10, maxRoots: 1, maxStartsInFlight: 1 },
      );

      const first = gateway.startWatching("/a");
      const firstExpectation = expect(first).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await firstExpectation;
      resolveStart?.({ rootPath: "/a", watchGeneration: 1 });

      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("stop_workspace_file_watch", {
          rootPath: "/a",
          watchGeneration: 1,
        }),
      );
      await expect(gateway.startWatching("/b")).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when a late start receipt is malformed", async () => {
    vi.useFakeTimers();
    try {
      let resolveStart: ((receipt: unknown) => void) | undefined;
      const invoke = vi.fn((command: string) => {
        if (command === "start_workspace_file_watch" && !resolveStart) {
          return new Promise<unknown>((resolve) => {
            resolveStart = resolve;
          });
        }
        return Promise.resolve(true);
      });
      const gateway = new TauriWorkspaceFileChangeGateway(
        invoke,
        vi.fn(async () => () => undefined),
        () => true,
        { operationTimeoutMs: 10, maxRoots: 1, maxStartsInFlight: 1 },
      );

      const first = gateway.startWatching("/a");
      const firstExpectation = expect(first).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await firstExpectation;
      resolveStart?.({ rootPath: "/a", watchGeneration: 1, unexpected: true });
      await Promise.resolve();
      await Promise.resolve();

      expect(invoke).not.toHaveBeenCalledWith("stop_workspace_file_watch", expect.anything());
      await expect(gateway.startWatching("/b")).rejects.toThrow("root capacity");
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds listener admissions and retains lifetime root capacity after release", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ rootPath: "/a", watchGeneration: 1 })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ rootPath: "/b", watchGeneration: 2 })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ rootPath: "/a", watchGeneration: 1 });
    const gateway = new TauriWorkspaceFileChangeGateway(
      invoke,
      vi.fn(async () => () => undefined),
      () => true,
      { maxListeners: 1, maxRoots: 1 },
    );
    const unsubscribe = await gateway.subscribeFileChanges(() => undefined);

    await expect(gateway.subscribeFileChanges(() => undefined)).rejects.toThrow(
      "listener capacity",
    );
    await gateway.startWatching("/a");
    await expect(gateway.startWatching("/b")).rejects.toThrow("root capacity");

    unsubscribe();
    await gateway.releaseRoot("/a");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("stop_workspace_file_watch", {
        rootPath: "/a",
        watchGeneration: 1,
      }),
    );
    await expect(gateway.startWatching("/b")).resolves.toBeUndefined();
    await gateway.releaseRoot("/b");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("stop_workspace_file_watch", {
        rootPath: "/b",
        watchGeneration: 2,
      }),
    );
    await expect(gateway.startWatching("/a")).resolves.toBeUndefined();
  });

  it("keeps an exact-generation tombstone across A-B-A start overlap", async () => {
    const resolvers: Array<(receipt: { rootPath: string; watchGeneration: number }) => void> = [];
    let emit: ((event: { payload: WireChange }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      vi.fn((command) =>
        command === "stop_workspace_file_watch"
          ? Promise.resolve(true)
          : new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
              resolvers.push(resolve);
            }),
      ),
      vi.fn(async (_event, handler) => {
        emit = handler;
        return () => undefined;
      }),
      () => true,
    );
    const received: WorkspaceFileChangeEvent[] = [];
    await gateway.subscribeFileChanges((event) => received.push(event));

    const firstA = gateway.startWatching("/a");
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    resolvers[0]?.({ rootPath: "/canonical/a", watchGeneration: 1 });
    await firstA;
    await gateway.releaseRoot("/a");

    const startingB = gateway.startWatching("/b");
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    emit?.({ payload: wireChange("/canonical/a", 1) });
    resolvers[1]?.({ rootPath: "/canonical/b", watchGeneration: 2 });
    await startingB;

    const secondA = gateway.startWatching("/a");
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    resolvers[2]?.({ rootPath: "/canonical/a", watchGeneration: 1 });
    await secondA;
    emit?.({ payload: wireChange("/canonical/a", 1) });

    expect(received).toEqual([change("/a", "rescanRequired"), change("/a")]);
  });

  it("disposes the transport subscription and rejects late starts", async () => {
    const unlisten = vi.fn();
    let resolveStart:
      ((receipt: { rootPath: string; watchGeneration: number }) => void) | undefined;
    const gateway = new TauriWorkspaceFileChangeGateway(
      vi.fn(
        () =>
          new Promise<{ rootPath: string; watchGeneration: number }>((resolve) => {
            resolveStart = resolve;
          }),
      ),
      vi.fn(async () => unlisten),
      () => true,
    );

    const starting = gateway.startWatching("/a");
    await vi.waitFor(() => expect(resolveStart).toBeTypeOf("function"));
    await gateway.dispose();
    resolveStart?.({ rootPath: "/a", watchGeneration: 1 });

    await expect(starting).rejects.toThrow("disposed");
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("disposal immediately rejects a never-settling listener registration", async () => {
    const gateway = new TauriWorkspaceFileChangeGateway(
      vi.fn(),
      vi.fn((): Promise<() => void> => new Promise(() => undefined)),
      () => true,
      { operationTimeoutMs: 60_000 },
    );
    const starting = gateway.startWatching("/a");
    const startingExpectation = expect(starting).rejects.toThrow("disposed");

    await gateway.dispose();

    await startingExpectation;
  });

  it("bounds disposal wait while retaining a never-settling stop permit", async () => {
    vi.useFakeTimers();
    try {
      const unlisten = vi.fn();
      const invoke = vi
        .fn()
        .mockResolvedValueOnce({ rootPath: "/a", watchGeneration: 1 })
        .mockImplementationOnce(() => new Promise(() => undefined));
      const gateway = new TauriWorkspaceFileChangeGateway(
        invoke,
        vi.fn(async () => unlisten),
        () => true,
        { operationTimeoutMs: 10 },
      );
      await gateway.startWatching("/a");

      const disposing = gateway.dispose();
      const disposingExpectation = expect(disposing).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(10);

      await disposingExpectation;
      expect(unlisten).toHaveBeenCalledOnce();
      expect(invoke).toHaveBeenLastCalledWith("stop_workspace_file_watch", {
        rootPath: "/a",
        watchGeneration: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an oversized root before listener or start IPC", async () => {
    const invoke = vi.fn();
    const listen = vi.fn(async () => () => undefined);
    const gateway = new TauriWorkspaceFileChangeGateway(invoke, listen, () => true);

    await expect(gateway.startWatching(`/${"x".repeat(32_768)}`)).rejects.toThrow("too large");
    expect(listen).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
