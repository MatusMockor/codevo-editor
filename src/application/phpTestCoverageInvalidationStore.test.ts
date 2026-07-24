import { describe, expect, it, vi } from "vitest";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import { createPhpTestCoverageInvalidationStore } from "./phpTestCoverageInvalidationStore";

describe("createPhpTestCoverageInvalidationStore", () => {
  it("publishes monotonic snapshots only for PHP coverage inputs", () => {
    const store = createPhpTestCoverageInvalidationStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.handleWorkspaceFileChange(event("README.md"));
    expect(store.getSnapshot()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    store.handleWorkspaceFileChange(event("src/Home.php"));
    store.handleWorkspaceFileChange(event("phpunit.xml"));
    expect(store.getSnapshot()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.handleWorkspaceFileChange(event("composer.lock"));
    expect(store.getSnapshot()).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("exposes stable external-store methods", () => {
    const store = createPhpTestCoverageInvalidationStore();
    expect(store.getSnapshot).toBe(store.getSnapshot);
    expect(store.subscribe).toBe(store.subscribe);
  });
});

function event(relativePath: string): WorkspaceFileChangeEvent {
  return {
    kind: "modified",
    path: `/workspace/${relativePath}`,
    relativePath,
    rootPath: "/workspace",
  };
}
