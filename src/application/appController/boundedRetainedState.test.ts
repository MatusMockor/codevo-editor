import { describe, expect, it } from "vitest";
import type { WorkspaceSettings } from "../../domain/settings";
import {
  BoundedPendingWorkspaceSettingsLoads,
  boundedPendingWorkspaceSettingsLoadsFor,
} from "./boundedPendingWorkspaceSettingsLoads";
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

  it("retains physical settings permits across controller remounts", () => {
    const settingsGateway = {};
    const firstSettingsStore = boundedPendingWorkspaceSettingsLoadsFor(settingsGateway);
    const remountedSettingsStore = boundedPendingWorkspaceSettingsLoadsFor(settingsGateway);

    expect(firstSettingsStore).not.toBe(remountedSettingsStore);
    expect(boundedPendingWorkspaceSettingsLoadsFor({})).not.toBe(firstSettingsStore);
    for (let index = 0; index < 8; index += 1) {
      firstSettingsStore.track(`settings-${index}`, [], () => new Promise<never>(() => undefined));
    }
    expect(() =>
      remountedSettingsStore.track("remount", [], () => new Promise<never>(() => undefined)),
    ).toThrow("Too many workspace settings reads are still pending");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
