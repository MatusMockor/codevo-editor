import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import { findInertiaComponentTarget } from "./inertiaComponentTarget";

const ROOT = "/workspace";

function fileEntry(path: string): FileEntry {
  return {
    kind: "file",
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
  };
}

describe("findInertiaComponentTarget", () => {
  it("uses a directory listing to find an existing component", async () => {
    const componentPath = `${ROOT}/resources/js/Pages/Users/Index.vue`;
    const readDirectory = vi.fn(async () => [fileEntry(componentPath)]);

    await expect(
      findInertiaComponentTarget("Users/Index", {
        currentWorkspaceRootRef: { current: ROOT },
        readDirectory,
      }),
    ).resolves.toEqual({
      name: "Users/Index",
      path: componentPath,
      position: { column: 1, lineNumber: 1 },
    });
    expect(readDirectory).toHaveBeenCalledWith(
      `${ROOT}/resources/js/Pages/Users`,
    );
  });

  it("lists a shared candidate directory exactly once", async () => {
    const componentPath = `${ROOT}/resources/js/Pages/Users/Index.jsx`;
    const readDirectory = vi.fn(async () => [fileEntry(componentPath)]);

    await expect(
      findInertiaComponentTarget("Users/Index", {
        currentWorkspaceRootRef: { current: ROOT },
        readDirectory,
      }),
    ).resolves.toMatchObject({ path: componentPath });
    expect(readDirectory).toHaveBeenCalledTimes(1);
  });

  it("drops a result when the active root changes during the directory read", async () => {
    const componentPath = `${ROOT}/resources/js/Pages/Users/Index.vue`;
    const currentWorkspaceRootRef: { current: string | null } = { current: ROOT };
    let resolveListing: (entries: FileEntry[]) => void = () => undefined;
    const listing = new Promise<FileEntry[]>((resolve) => {
      resolveListing = resolve;
    });
    const readDirectory = vi.fn(() => listing);

    const result = findInertiaComponentTarget("Users/Index", {
      currentWorkspaceRootRef,
      readDirectory,
    });
    currentWorkspaceRootRef.current = "/other";
    resolveListing([fileEntry(componentPath)]);

    await expect(result).resolves.toBeNull();
  });
});
