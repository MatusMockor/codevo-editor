// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerDescriptor, RemoteRunnerProject } from "../domain/remoteRunner";
import {
  MAX_REMOTE_PROJECT_INVENTORY_SERVERS,
  REMOTE_PROJECT_INVENTORY_SLOW_AFTER_MS,
  useRemoteProjectInventories,
  type RemoteProjectInventories,
  type RemoteProjectInventoryGateway,
} from "./useRemoteProjectInventories";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

type ProjectPage = Readonly<{ items: readonly RemoteRunnerProject[] }>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function descriptor(runnerId: string): RemoteRunnerDescriptor {
  return {
    protocolVersion: 1,
    runnerId,
    name: "Runner",
    capabilities: { taskExecution: true, eventReplay: true },
  };
}

function controlledGateway() {
  const pages: Deferred<ProjectPage>[] = [];
  const requested: string[] = [];
  const gateway = {
    getRunner: vi.fn(async ({ serverId }: { serverId: string }) =>
      descriptor(`${serverId}-runner`),
    ),
    listProjects: vi.fn(({ serverId }: { serverId: string }) => {
      const page = deferred<ProjectPage>();
      pages.push(page);
      requested.push(serverId);
      return page.promise;
    }),
  };
  return { gateway, pages, requested };
}

describe("useRemoteProjectInventories", () => {
  let host: HTMLDivElement;
  let root: Root;
  let snapshots: RemoteProjectInventories[];

  function Probe({
    gateway,
    serverIds,
    enabled,
  }: {
    readonly gateway: RemoteProjectInventoryGateway | null;
    readonly serverIds: ReadonlyArray<string>;
    readonly enabled: boolean;
  }) {
    snapshots.push(useRemoteProjectInventories(gateway, serverIds, enabled));
    return null;
  }

  function render(
    gateway: RemoteProjectInventoryGateway | null,
    serverIds: ReadonlyArray<string>,
    enabled: boolean,
  ) {
    act(() => root.render(<Probe gateway={gateway} serverIds={serverIds} enabled={enabled} />));
  }

  function latest(): ReadonlyArray<readonly [string, string]> {
    const snapshot = snapshots[snapshots.length - 1];
    return [...(snapshot ?? [])].map(([serverId, inventory]) => [serverId, inventory.kind]);
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    snapshots = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("loads nothing while disabled or without a gateway", () => {
    const { gateway } = controlledGateway();
    render(gateway, ["a"], false);
    expect(latest()).toEqual([]);
    render(null, ["a"], true);
    expect(latest()).toEqual([]);
    expect(gateway.getRunner).not.toHaveBeenCalled();
    expect(gateway.listProjects).not.toHaveBeenCalled();
  });

  it("publishes each server independently and isolates a failed server", async () => {
    const { gateway, pages } = controlledGateway();
    render(gateway, ["a", "b"], true);
    expect(snapshots.every((snapshot) => snapshot.get("a")?.kind === "loading")).toBe(true);
    expect(latest()).toEqual([
      ["a", "loading"],
      ["b", "loading"],
    ]);
    await act(async () => pages[1]?.reject(new Error("offline")));
    expect(latest()).toEqual([
      ["a", "loading"],
      ["b", "failed"],
    ]);
    await act(async () => pages[0]?.resolve({ items: [{ id: "p", name: "Project" }] }));
    expect(snapshots[snapshots.length - 1]?.get("a")).toEqual({
      kind: "ready",
      runnerId: "a-runner",
      projects: [{ id: "p", name: "Project" }],
    });
    expect(gateway.listProjects).toHaveBeenCalledTimes(2);
  });

  it("does not publish a result that arrives after loading was disabled", async () => {
    const { gateway, pages } = controlledGateway();
    render(gateway, ["a"], true);
    render(gateway, ["a"], false);
    expect(latest()).toEqual([]);
    const renders = snapshots.length;
    await act(async () => pages[0]?.resolve({ items: [{ id: "p", name: "Project" }] }));
    expect(snapshots).toHaveLength(renders);
    render(gateway, ["a"], true);
    expect(snapshots.slice(renders).every((snapshot) => snapshot.get("a")?.kind !== "ready")).toBe(
      true,
    );
    expect(latest()).toEqual([["a", "loading"]]);
    expect(gateway.listProjects).toHaveBeenCalledTimes(2);
    await act(async () => pages[1]?.resolve({ items: [] }));
    expect(latest()).toEqual([["a", "ready"]]);
  });

  it("ignores a late result from the previous server set and the previous gateway", async () => {
    const first = controlledGateway();
    const second = controlledGateway();
    render(first.gateway, ["a"], true);
    render(first.gateway, ["b"], true);
    await act(async () => first.pages[0]?.resolve({ items: [{ id: "p", name: "Old" }] }));
    expect(latest()).toEqual([["b", "loading"]]);
    render(second.gateway, ["b"], true);
    await act(async () => first.pages[1]?.resolve({ items: [{ id: "p", name: "Old" }] }));
    expect(latest()).toEqual([["b", "loading"]]);
    await act(async () => second.pages[0]?.resolve({ items: [] }));
    expect(latest()).toEqual([["b", "ready"]]);
  });

  it("keeps loaded inventories when the same servers are passed as a new array", async () => {
    const { gateway, pages } = controlledGateway();
    render(gateway, ["a"], true);
    await act(async () => pages[0]?.resolve({ items: [] }));
    render(gateway, ["a"], true);
    expect(latest()).toEqual([["a", "ready"]]);
    expect(gateway.listProjects).toHaveBeenCalledTimes(1);
  });

  it("reports a slow load as still loading and accepts its late result", async () => {
    vi.useFakeTimers();
    const { gateway, pages } = controlledGateway();
    render(gateway, ["a", "b", "c"], true);
    await act(async () => pages[0]?.resolve({ items: [] }));
    act(() => {
      vi.advanceTimersByTime(REMOTE_PROJECT_INVENTORY_SLOW_AFTER_MS - 1);
    });
    expect(latest()).toEqual([
      ["a", "ready"],
      ["b", "loading"],
      ["c", "loading"],
    ]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(latest()).toEqual([
      ["a", "ready"],
      ["b", "slow"],
      ["c", "slow"],
    ]);
    await act(async () => pages[1]?.resolve({ items: [{ id: "p", name: "Late" }] }));
    await act(async () => pages[2]?.reject(new Error("offline")));
    expect(latest()).toEqual([
      ["a", "ready"],
      ["b", "ready"],
      ["c", "failed"],
    ]);
  });

  it("stops the slow-load timer when the servers change and on unmount", () => {
    vi.useFakeTimers();
    const { gateway } = controlledGateway();
    render(gateway, ["a"], true);
    render(gateway, ["b"], true);
    expect(vi.getTimerCount()).toBe(1);
    render(gateway, ["b"], false);
    expect(vi.getTimerCount()).toBe(0);
    render(gateway, ["b"], true);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });

  it("loads at most the bounded number of servers", () => {
    const { gateway, requested } = controlledGateway();
    const serverIds = Array.from(
      { length: MAX_REMOTE_PROJECT_INVENTORY_SERVERS + 3 },
      (_, index) => `s${index}`,
    );
    render(gateway, serverIds, true);
    expect(requested).toEqual(serverIds.slice(0, MAX_REMOTE_PROJECT_INVENTORY_SERVERS));
    expect(latest()).toHaveLength(MAX_REMOTE_PROJECT_INVENTORY_SERVERS);
  });
});
