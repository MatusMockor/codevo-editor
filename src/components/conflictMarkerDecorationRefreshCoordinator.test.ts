import { describe, expect, it, vi } from "vitest";
import {
  ConflictMarkerDecorationRefreshCoordinator,
  MAX_CONFLICT_MARKER_DECORATION_SOURCE_CHARACTERS,
  type ConflictMarkerDecorationRefreshAuthority,
  type ConflictMarkerDecorationRefreshResult,
} from "./conflictMarkerDecorationRefreshCoordinator";

describe("ConflictMarkerDecorationRefreshCoordinator", () => {
  it("coalesces a rapid typing burst into one bounded full-source projection", () => {
    const scheduler = manualScheduler();
    const coordinator = new ConflictMarkerDecorationRefreshCoordinator<readonly string[]>(
      scheduler,
      120,
      1_000_000,
    );
    const owner = {};
    let version = 0;
    let source = "x".repeat(400_000);
    const project = vi.fn((value: string) => [String(value.length)]);
    const publish = vi.fn();

    for (let index = 0; index < 100; index += 1) {
      version += 1;
      source += "x";
      const requestedVersion = version;
      const requestedAuthority = authority(
        owner,
        "file:///workspace/a.ts",
        "/workspace/a.ts",
        requestedVersion,
      );
      coordinator.request({
        authority: requestedAuthority,
        currentAuthority: () =>
          authority(owner, "file:///workspace/a.ts", "/workspace/a.ts", version),
        isCurrent: () => version === requestedVersion,
        project,
        publish,
        readSource: () => source,
        sourceCharacters: source.length,
      });
    }

    expect(project).not.toHaveBeenCalled();
    expect(scheduler.size()).toBe(1);
    scheduler.flushAll();

    expect(project).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      kind: "ready",
      projection: [String(source.length)],
      scannedCharacters: source.length,
    });
    expect(coordinator.metrics()).toMatchObject({
      cancelledRequests: 99,
      publishedRequests: 1,
      scannedCharacters: source.length,
      scans: 1,
      scheduledRequests: 100,
      staleRequests: 0,
    });
  });

  it("degrades without reading or parsing a source above the independent hard limit", () => {
    const scheduler = manualScheduler();
    const coordinator = new ConflictMarkerDecorationRefreshCoordinator<readonly string[]>(
      scheduler,
    );
    const readSource = vi.fn(() => "must not be read");
    const project = vi.fn(() => ["must not be projected"]);
    const publish = vi.fn();
    const sourceCharacters = MAX_CONFLICT_MARKER_DECORATION_SOURCE_CHARACTERS + 1;

    const requestedAuthority = authority({}, "file:///workspace/huge.ts", "/workspace/huge.ts", 1);
    coordinator.request({
      authority: requestedAuthority,
      currentAuthority: () => requestedAuthority,
      isCurrent: () => true,
      project,
      publish,
      readSource,
      sourceCharacters,
    });
    scheduler.flushAll();

    expect(readSource).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith({
      characterLimit: MAX_CONFLICT_MARKER_DECORATION_SOURCE_CHARACTERS,
      kind: "degraded",
      reason: "source-too-large",
      sourceCharacters,
    });
    expect(coordinator.metrics()).toMatchObject({
      degradedRequests: 1,
      scannedCharacters: 0,
      scans: 0,
    });
  });

  it("drops stale A to B to A work even when the original model and version return", () => {
    const scheduler = manualScheduler();
    const coordinator = new ConflictMarkerDecorationRefreshCoordinator<readonly string[]>(
      scheduler,
    );
    const modelA = {};
    const modelB = {};
    let activeModel = modelA;
    let activePath = "/workspace/a.ts";
    type Publish = (result: ConflictMarkerDecorationRefreshResult<readonly string[]>) => void;
    const publishA1 = vi.fn<Publish>();
    const publishB = vi.fn<Publish>();
    const publishA2 = vi.fn<Publish>();
    const request = (model: object, path: string, source: string, publish: Publish) => {
      const requestedModel = model;
      const requestedPath = path;
      coordinator.request({
        authority: authority(model, `file://${path}`, path, 1),
        currentAuthority: () => authority(activeModel, `file://${activePath}`, activePath, 1),
        isCurrent: () => activeModel === requestedModel && activePath === requestedPath,
        project: (value) => [value],
        publish,
        readSource: () => source,
        sourceCharacters: source.length,
      });
    };

    request(modelA, "/workspace/a.ts", "old-a", publishA1);
    activeModel = modelB;
    activePath = "/workspace/b.ts";
    request(modelB, "/workspace/b.ts", "b", publishB);
    activeModel = modelA;
    activePath = "/workspace/a.ts";
    request(modelA, "/workspace/a.ts", "new-a", publishA2);
    scheduler.flushAll();

    expect(publishA1).not.toHaveBeenCalled();
    expect(publishB).not.toHaveBeenCalled();
    expect(publishA2).toHaveBeenCalledWith({
      kind: "ready",
      projection: ["new-a"],
      scannedCharacters: 5,
    });
    expect(coordinator.metrics()).toMatchObject({
      cancelledRequests: 2,
      publishedRequests: 1,
      scans: 1,
    });
  });

  it("drops a result when projection reentrantly supersedes its owner", () => {
    const scheduler = manualScheduler();
    const coordinator = new ConflictMarkerDecorationRefreshCoordinator<readonly string[]>(
      scheduler,
    );
    const publish = vi.fn();
    const owner = {};
    let version = 1;

    coordinator.request({
      authority: authority(owner, "file:///workspace/a.ts", "/workspace/a.ts", version),
      currentAuthority: () =>
        authority(owner, "file:///workspace/a.ts", "/workspace/a.ts", version),
      isCurrent: () => version === 1,
      project: (source) => {
        version = 2;
        return [source];
      },
      publish,
      readSource: () => "source",
      sourceCharacters: 6,
    });
    scheduler.flushAll();

    expect(publish).not.toHaveBeenCalled();
    expect(coordinator.metrics()).toMatchObject({
      publishedRequests: 0,
      scannedCharacters: 6,
      scans: 1,
      staleRequests: 1,
    });
  });
});

function authority(
  model: object,
  modelUri: string,
  path: string,
  version: number,
): ConflictMarkerDecorationRefreshAuthority {
  return {
    model,
    modelUri,
    ownerKey: "workspace-owner",
    path,
    version,
  };
}

function manualScheduler() {
  let nextId = 0;
  const callbacks = new Map<number, () => void>();
  return {
    clear(handle: unknown) {
      callbacks.delete(handle as number);
    },
    flushAll() {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      pending.forEach(([, callback]) => callback());
    },
    schedule(callback: () => void) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    size: () => callbacks.size,
  };
}
