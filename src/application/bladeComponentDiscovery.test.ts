import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";
import {
  bladeComponentNameFromRelativePath,
  collectBladeComponentNames,
  invalidateBladeComponentNamesForPath,
  type BladeComponentDiscoveryDependencies,
  type BladeComponentNamesCacheRef,
} from "./bladeComponentDiscovery";

const ROOT = "/workspace";
const ANONYMOUS_COMPONENTS_ROOT = `${ROOT}/resources/views/components`;
const CLASS_COMPONENTS_ROOT = `${ROOT}/app/View/Components`;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function fileEntry(path: string): FileEntry {
  return {
    kind: "file",
    name: path.split("/").pop() ?? path,
    path,
  };
}

function directoryEntry(path: string): FileEntry {
  return {
    kind: "directory",
    name: path.split("/").pop() ?? path,
    path,
  };
}

function relativePath(workspaceRoot: string, path: string): string {
  return workspaceRelativePath(workspaceRoot, path) ?? path;
}

function createDependencies(
  entries: Record<string, FileEntry[]>,
  cacheRef: BladeComponentNamesCacheRef = { current: {} },
): BladeComponentDiscoveryDependencies {
  const readDirectory = vi.fn(async (path: string) => {
    if (!(path in entries)) {
      throw new Error(`No such directory: ${path}`);
    }

    return entries[path];
  });

  return {
    cacheRef,
    currentWorkspaceRootRef: { current: ROOT },
    relativeWorkspacePath: relativePath,
    workspaceFiles: { readDirectory },
    workspaceRoot: ROOT,
  };
}

describe("bladeComponentNameFromRelativePath", () => {
  it("maps anonymous component files to dotted tags and directory indexes to parent tags", () => {
    expect(bladeComponentNameFromRelativePath("alert.blade.php")).toBe("alert");
    expect(
      bladeComponentNameFromRelativePath("forms/text-input.blade.php"),
    ).toBe("forms.text-input");
    expect(bladeComponentNameFromRelativePath("forms/index.blade.php")).toBe(
      "forms",
    );
  });
});

describe("collectBladeComponentNames", () => {
  it("maps class component files to kebab and dotted tags", async () => {
    const deps = createDependencies({
      [ANONYMOUS_COMPONENTS_ROOT]: [],
      [CLASS_COMPONENTS_ROOT]: [
        fileEntry(`${CLASS_COMPONENTS_ROOT}/AlertBox.php`),
        directoryEntry(`${CLASS_COMPONENTS_ROOT}/Forms`),
      ],
      [`${CLASS_COMPONENTS_ROOT}/Forms`]: [
        fileEntry(`${CLASS_COMPONENTS_ROOT}/Forms/TextInput.php`),
      ],
    });

    await expect(collectBladeComponentNames(deps)).resolves.toEqual([
      "alert-box",
      "forms.text-input",
    ]);
  });

  it("returns sorted unique names from anonymous and class components", async () => {
    const deps = createDependencies({
      [ANONYMOUS_COMPONENTS_ROOT]: [
        fileEntry(`${ANONYMOUS_COMPONENTS_ROOT}/zeta.blade.php`),
        directoryEntry(`${ANONYMOUS_COMPONENTS_ROOT}/forms`),
      ],
      [`${ANONYMOUS_COMPONENTS_ROOT}/forms`]: [
        fileEntry(`${ANONYMOUS_COMPONENTS_ROOT}/forms/text-input.blade.php`),
        fileEntry(`${ANONYMOUS_COMPONENTS_ROOT}/forms/index.blade.php`),
      ],
      [CLASS_COMPONENTS_ROOT]: [
        fileEntry(`${CLASS_COMPONENTS_ROOT}/AlertBox.php`),
        directoryEntry(`${CLASS_COMPONENTS_ROOT}/Forms`),
      ],
      [`${CLASS_COMPONENTS_ROOT}/Forms`]: [
        fileEntry(`${CLASS_COMPONENTS_ROOT}/Forms/TextInput.php`),
      ],
    });

    await expect(collectBladeComponentNames(deps)).resolves.toEqual([
      "alert-box",
      "forms",
      "forms.text-input",
      "zeta",
    ]);
  });

  it("uses cached names without reading directories again", async () => {
    const deps = createDependencies({
      [ANONYMOUS_COMPONENTS_ROOT]: [
        fileEntry(`${ANONYMOUS_COMPONENTS_ROOT}/alert.blade.php`),
      ],
      [CLASS_COMPONENTS_ROOT]: [],
    });

    await expect(collectBladeComponentNames(deps)).resolves.toEqual(["alert"]);
    await expect(collectBladeComponentNames(deps)).resolves.toEqual(["alert"]);

    expect(deps.workspaceFiles.readDirectory).toHaveBeenCalledTimes(2);
  });

  it("drops stale-root results and does not cache them", async () => {
    const deferred = createDeferred<FileEntry[]>();
    const cacheRef: BladeComponentNamesCacheRef = { current: {} };
    const currentWorkspaceRootRef: { current: string | null } = {
      current: ROOT,
    };
    const readDirectory = vi
      .fn()
      .mockImplementationOnce(() => deferred.promise)
      .mockResolvedValue([]);
    const deps: BladeComponentDiscoveryDependencies = {
      cacheRef,
      currentWorkspaceRootRef,
      relativeWorkspacePath: relativePath,
      workspaceFiles: { readDirectory },
      workspaceRoot: ROOT,
    };

    const pending = collectBladeComponentNames(deps);

    currentWorkspaceRootRef.current = "/other";
    deferred.resolve([fileEntry(`${ANONYMOUS_COMPONENTS_ROOT}/leaked.blade.php`)]);

    await expect(pending).resolves.toEqual([]);
    expect(cacheRef.current[ROOT]).toBeUndefined();
  });
});

describe("invalidateBladeComponentNamesForPath", () => {
  it("only invalidates cached names for component source paths", () => {
    const cacheRef: BladeComponentNamesCacheRef = {
      current: {
        [ROOT]: ["alert"],
      },
    };

    invalidateBladeComponentNamesForPath(
      cacheRef,
      ROOT,
      `${ROOT}/resources/views/pages/home.blade.php`,
    );
    expect(cacheRef.current[ROOT]).toEqual(["alert"]);

    invalidateBladeComponentNamesForPath(
      cacheRef,
      ROOT,
      `${ANONYMOUS_COMPONENTS_ROOT}/alert.blade.php`,
    );
    expect(cacheRef.current[ROOT]).toBeUndefined();
  });
});
