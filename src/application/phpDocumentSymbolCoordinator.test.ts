import { describe, expect, it, vi } from "vitest";
import { PhpDocumentSymbolCoordinator } from "./phpDocumentSymbolCoordinator";

const request = {
  content: "<?php class User {}",
  path: "/project/User.php",
  rootPath: "/project",
  runtimeIdentity: {},
  sessionId: 7,
};

describe("PhpDocumentSymbolCoordinator", () => {
  it("shares an overlapping request for the same exact server snapshot", async () => {
    const coordinator = new PhpDocumentSymbolCoordinator();
    let resolve!: (value: []) => void;
    const load = vi.fn(
      () =>
        new Promise<[]>((done) => {
          resolve = done;
        }),
    );
    const first = coordinator.coordinate(request, load);
    const second = coordinator.coordinate(
      { ...request, rootPath: "/project/" },
      load,
    );
    await Promise.resolve();
    resolve([]);
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["changed content", { content: "<?php class Admin {}" }],
    ["different root", { rootPath: "/other" }],
    ["different session", { sessionId: 8 }],
    ["different runtime", { runtimeIdentity: {} }],
  ])("does not share for %s", async (_label, difference) => {
    const coordinator = new PhpDocumentSymbolCoordinator();
    let resolveFirst!: (value: []) => void;
    const firstLoad = vi.fn(
      () =>
        new Promise<[]>((done) => {
          resolveFirst = done;
        }),
    );
    const secondLoad = vi.fn(async () => []);
    const first = coordinator.coordinate(request, firstLoad);
    await coordinator.coordinate({ ...request, ...difference }, secondLoad);
    resolveFirst([]);
    await first;
    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(secondLoad).toHaveBeenCalledTimes(1);
  });

  it("evicts a rejected request so a later call can retry", async () => {
    const coordinator = new PhpDocumentSymbolCoordinator();
    await expect(
      coordinator.coordinate(request, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const retry = vi.fn(async () => []);
    await expect(coordinator.coordinate(request, retry)).resolves.toEqual([]);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
