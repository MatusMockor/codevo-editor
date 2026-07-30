import { describe, expect, it } from "vitest";
import type { WorkspaceSettings } from "../../domain/settings";
import {
  BoundedInFlightDirectoryLoads,
  boundedInFlightDirectoryLoadsFor,
} from "./boundedInFlightDirectoryLoads";
import {
  BoundedPendingWorkspaceSettingsLoads,
  boundedPendingWorkspaceSettingsLoadsFor,
} from "./boundedPendingWorkspaceSettingsLoads";
import {
  beginExternallyRemovedDocumentEvent,
  beginWorkspaceFileTombstoneEvent,
  clearAllExternallyRemovedDocumentTombstones,
  clearExternallyRemovedDocumentTombstonesForRoot,
  forgetExternallyRemovedDocumentTombstone,
  hasExternallyRemovedDocumentTombstone,
  markExternallyRemovedDocumentTombstone,
  reconcileExternallyRemovedDocumentEvent,
} from "./externallyRemovedDocumentTombstones";
import { LatestWorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";

describe("bounded workbench retained state", () => {
  it("retires a superseded workspace request without letting its late completion clear the winner", () => {
    const registry = new LatestWorkspaceRequestTokenRegistry();

    registry.issue(1);
    registry.issue(2);
    registry.complete(1);

    expect(registry.pendingToken()).toBe(2);
    expect(registry.hasPending()).toBe(true);

    registry.complete(2);
    expect(registry.hasPending()).toBe(false);

    registry.issue(3);
    registry.retire();
    expect(registry.hasPending()).toBe(false);
  });

  it("caps physical settings loads and ignores a replaced load's late settlement", async () => {
    const store = new BoundedPendingWorkspaceSettingsLoads(2);
    const first = deferred<WorkspaceSettings>();
    const replacement = deferred<WorkspaceSettings>();
    const second = deferred<WorkspaceSettings>();
    const third = deferred<WorkspaceSettings>();

    store.track("a", [], () => first.promise);
    store.track("b", [], () => second.promise);
    expect(() => store.track("c", [], () => third.promise)).toThrow(
      "Too many workspace settings reads are still pending",
    );
    expect(() => store.track("b", ["new-alias"], () => replacement.promise)).toThrow(
      "Too many workspace settings reads are still pending",
    );
    expect(store.size()).toBe(2);
    expect(store.get("a")?.promise).toBe(first.promise);

    first.resolve({} as WorkspaceSettings);
    await first.promise;
    await Promise.resolve();
    store.track("b", [], () => replacement.promise);
    second.resolve({} as WorkspaceSettings);
    await second.promise;
    await Promise.resolve();

    expect(store.get("b")?.promise).toBe(replacement.promise);
    expect(store.size()).toBe(1);
  });

  it("retains physical settings and directory permits across controller remounts", () => {
    const settingsGateway = {};
    const workspaceFiles = {};
    const firstDirectoryStore = boundedInFlightDirectoryLoadsFor(workspaceFiles);
    const remountedDirectoryStore = boundedInFlightDirectoryLoadsFor(workspaceFiles);
    const firstSettingsStore = boundedPendingWorkspaceSettingsLoadsFor(settingsGateway);
    const remountedSettingsStore = boundedPendingWorkspaceSettingsLoadsFor(settingsGateway);

    expect(firstSettingsStore).not.toBe(remountedSettingsStore);
    expect(firstDirectoryStore).not.toBe(remountedDirectoryStore);
    expect(boundedPendingWorkspaceSettingsLoadsFor({})).not.toBe(firstSettingsStore);
    for (let index = 0; index < 8; index += 1) {
      firstSettingsStore.track(`settings-${index}`, [], () => new Promise<never>(() => undefined));
    }
    expect(() =>
      remountedSettingsStore.track("remount", [], () => new Promise<never>(() => undefined)),
    ).toThrow("Too many workspace settings reads are still pending");
    for (let index = 0; index < 32; index += 1) {
      const generation = Math.floor(index / 8);
      const requestId = Symbol(`request-${index}`);
      expect(
        firstDirectoryStore.admit(`request-${index}`, {
          generation,
          path: `/workspace/${index}`,
          promise: new Promise<never>(() => undefined),
          requestId,
          rootPath: "/workspace",
        }),
      ).toBe(true);
    }
    expect(remountedDirectoryStore.canAdmit("remount", 1)).toBe(false);
  });

  it("caps directory requests and deletes only the exact settled request", () => {
    const store = new BoundedInFlightDirectoryLoads(1);
    const firstRequestId = Symbol("first");
    const replacementRequestId = Symbol("replacement");
    const load = (requestId: symbol) => ({
      generation: 1,
      path: "/workspace/src",
      promise: new Promise<never>(() => undefined),
      requestId,
      rootPath: "/workspace",
    });

    expect(store.admit("first", load(firstRequestId))).toBe(true);
    expect(store.canAdmit("second", 1)).toBe(false);
    expect(store.admit("second", load(Symbol("second")))).toBe(false);
    expect(store.size()).toBe(1);

    expect(store.admit("first", load(replacementRequestId))).toBe(false);
    store.deleteIfCurrent("first", firstRequestId);
    expect(store.size()).toBe(0);
    expect(store.admit("first", load(replacementRequestId))).toBe(true);
    store.deleteIfCurrent("first", replacementRequestId);
    expect(store.size()).toBe(0);
  });

  it("reserves bounded capacity for a replacement generation without retiring physical work", () => {
    const store = new BoundedInFlightDirectoryLoads(2, 1);
    const staleRequestId = Symbol("stale");
    const currentRequestId = Symbol("current");
    const load = (generation: number, requestId: symbol) => ({
      generation,
      path: "/workspace/src",
      promise: new Promise<never>(() => undefined),
      requestId,
      rootPath: "/workspace",
    });

    store.admit("generation-1", load(1, staleRequestId));
    store.admit("generation-2", load(2, currentRequestId));
    store.deleteIfCurrent("generation-1", staleRequestId);
    expect(store.size()).toBe(1);
  });

  it("evicts tombstones deterministically and clears only the disposed root", () => {
    const tombstones: Record<string, string> = {};

    markExternallyRemovedDocumentTombstone(tombstones, "/a", "/a/one.ts", 2);
    markExternallyRemovedDocumentTombstone(tombstones, "/a", "/a/two.ts", 2);
    markExternallyRemovedDocumentTombstone(tombstones, "/b", "/b/three.ts", 2);

    expect(tombstones).toEqual({
      "/a/two.ts": "/a",
      "/b/three.ts": "/b",
    });
    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/a/one.ts")).toBe(true);
    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/b/unknown.ts")).toBe(false);

    clearExternallyRemovedDocumentTombstonesForRoot(tombstones, "/a");
    expect(tombstones).toEqual({ "/b/three.ts": "/b" });

    forgetExternallyRemovedDocumentTombstone(tombstones, "/b/three.ts");
    expect(tombstones).toEqual({});
  });

  it("does not restore a removed tombstone after a newer create event", () => {
    const tombstones: Record<string, string> = {};
    const removed = beginExternallyRemovedDocumentEvent(
      tombstones,
      "/workspace/file.ts",
      "removed",
    );
    markExternallyRemovedDocumentTombstone(tombstones, "/workspace", "/workspace/file.ts");
    beginExternallyRemovedDocumentEvent(tombstones, "/workspace/file.ts", "present");
    forgetExternallyRemovedDocumentTombstone(tombstones, "/workspace/file.ts");

    expect(reconcileExternallyRemovedDocumentEvent(tombstones, removed)).toBe(false);
    expect(tombstones).toEqual({});

    markExternallyRemovedDocumentTombstone(tombstones, "/workspace", "/workspace/renamed.ts");
    beginWorkspaceFileTombstoneEvent(tombstones, {
      kind: "modified",
      path: "/workspace/renamed.ts",
      rootPath: "/workspace",
    });
    expect(tombstones).toEqual({});
  });

  it("retains independent overflow authority until each exact root is rescanned", () => {
    const tombstones: Record<string, string> = {};
    markExternallyRemovedDocumentTombstone(tombstones, "/a", "/a/one.ts", 1);
    markExternallyRemovedDocumentTombstone(tombstones, "/a", "/a/two.ts", 1);
    markExternallyRemovedDocumentTombstone(tombstones, "/b", "/b/one.ts", 1);
    markExternallyRemovedDocumentTombstone(tombstones, "/b", "/b/two.ts", 1);

    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/a/unknown.ts")).toBe(true);
    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/b/unknown.ts")).toBe(true);

    beginWorkspaceFileTombstoneEvent(tombstones, {
      kind: "rescanRequired",
      path: "/b",
      rootPath: "/b",
    });
    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/a/unknown.ts")).toBe(true);
    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/b/unknown.ts")).toBe(false);
  });

  it("clears global overflow authority only during authoritative all-root cleanup", () => {
    const tombstones: Record<string, string> = {};
    for (let index = 0; index < 17; index += 1) {
      const rootPath = `/workspace-${index}`;
      markExternallyRemovedDocumentTombstone(tombstones, rootPath, `${rootPath}/one.ts`, 1);
      markExternallyRemovedDocumentTombstone(tombstones, rootPath, `${rootPath}/two.ts`, 1);
    }
    const staleRemoval = beginExternallyRemovedDocumentEvent(
      tombstones,
      "/workspace-0/stale.ts",
      "removed",
    );

    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/any-root/unknown.ts")).toBe(true);
    clearAllExternallyRemovedDocumentTombstones(tombstones);
    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/any-root/unknown.ts")).toBe(false);
    expect(reconcileExternallyRemovedDocumentEvent(tombstones, staleRemoval)).toBe(false);
  });

  it("releases settled present authority and preserves a newer removal across stale settlement", () => {
    const tombstones: Record<string, string> = {};
    for (let index = 0; index < 2_000; index += 1) {
      beginWorkspaceFileTombstoneEvent(tombstones, {
        kind: "created",
        path: `/workspace/present-${index}.ts`,
        rootPath: "/workspace",
      });
    }

    const staleRemoval = beginExternallyRemovedDocumentEvent(
      tombstones,
      "/workspace/file.ts",
      "removed",
    );
    const currentRemoval = beginExternallyRemovedDocumentEvent(
      tombstones,
      "/workspace/file.ts",
      "removed",
    );
    markExternallyRemovedDocumentTombstone(tombstones, "/workspace", "/workspace/file.ts");

    expect(reconcileExternallyRemovedDocumentEvent(tombstones, currentRemoval)).toBe(true);
    expect(reconcileExternallyRemovedDocumentEvent(tombstones, staleRemoval)).toBe(false);
    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/workspace/file.ts")).toBe(true);
  });

  it("rejects event-authority overflow without evicting an unsettled removal", () => {
    const tombstones: Record<string, string> = {};
    const admitted = Array.from({ length: 1_024 }, (_, index) =>
      beginExternallyRemovedDocumentEvent(tombstones, `/workspace/${index}.ts`, "removed"),
    );
    const overflow = beginExternallyRemovedDocumentEvent(
      tombstones,
      "/workspace/overflow.ts",
      "removed",
    );

    expect(overflow.admitted).toBe(false);
    expect(reconcileExternallyRemovedDocumentEvent(tombstones, overflow)).toBe(false);
    beginWorkspaceFileTombstoneEvent(tombstones, {
      kind: "deleted",
      path: "/workspace/another-overflow.ts",
      rootPath: "/workspace",
    });
    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/workspace/unknown.ts")).toBe(true);
    expect(reconcileExternallyRemovedDocumentEvent(tombstones, admitted[0]!)).toBe(true);
    clearExternallyRemovedDocumentTombstonesForRoot(tombstones, "/workspace");
    expect(hasExternallyRemovedDocumentTombstone(tombstones, "/workspace/unknown.ts")).toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
