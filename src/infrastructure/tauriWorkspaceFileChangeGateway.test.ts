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
});
