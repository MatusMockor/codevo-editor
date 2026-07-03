// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useWorkspaceTodos,
  type WorkspaceTodos,
  type WorkspaceTodosDependencies,
} from "./useWorkspaceTodos";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import type { EditorPosition } from "../domain/languageServerFeatures";

const ROOT = "/workspace";

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

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");

  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }

  return path;
}

/**
 * A WorkspaceFileGateway whose directory tree is overridable per test. Only
 * readDirectory/readTextFile are stubbed; the hook never calls the rest.
 */
function createFakeWorkspaceFiles(
  overrides: Partial<WorkspaceFileGateway> = {},
): WorkspaceFileGateway {
  const base = {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => [] as FileEntry[]),
    readTextFile: vi.fn(async () => ""),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
  };
  return { ...base, ...overrides } as unknown as WorkspaceFileGateway;
}

function directoryTree(
  entries: Record<string, FileEntry[]>,
): WorkspaceFileGateway["readDirectory"] {
  return vi.fn(async (path: string) => entries[path] ?? []);
}

interface Harness {
  hook: () => WorkspaceTodos;
  ref: { current: string | null };
  openNavigationTarget: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderWorkspaceTodos(
  overrides: Partial<WorkspaceTodosDependencies> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { hook: WorkspaceTodos | null } = { hook: null };

  const ref: { current: string | null } = { current: ROOT };
  const openNavigationTarget = vi.fn(
    async (_path: string, _position: EditorPosition, _label: string) => true,
  );

  const deps: WorkspaceTodosDependencies = {
    workspaceFiles: createFakeWorkspaceFiles(),
    currentWorkspaceRootRef: ref,
    workspaceRoot: ROOT,
    openNavigationTarget,
    relativeWorkspacePath,
    ...overrides,
  };

  function Harness() {
    captured.hook = useWorkspaceTodos(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    hook: () => {
      if (!captured.hook) {
        throw new Error("hook not mounted");
      }
      return captured.hook;
    },
    ref,
    openNavigationTarget,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function fileEntry(path: string, name = path.split("/").pop() ?? path): FileEntry {
  return { kind: "file", name, path };
}

function directoryEntry(path: string, name = path.split("/").pop() ?? path): FileEntry {
  return { kind: "directory", name, path };
}

describe("useWorkspaceTodos", () => {
  it("opens the panel and populates the scanned TODOs, then closes it", async () => {
    const readDirectory = directoryTree({
      [ROOT]: [fileEntry(`${ROOT}/a.ts`)],
    });
    const readTextFile = vi.fn(async () => "// TODO: fix this\nconst x = 1;\n");
    const harness = renderWorkspaceTodos({
      workspaceFiles: createFakeWorkspaceFiles({ readDirectory, readTextFile }),
    });

    await act(async () => {
      harness.hook().openTodoPanel();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.hook().todoPanelOpen).toBe(true);
    expect(harness.hook().workspaceTodos).toHaveLength(1);
    expect(harness.hook().workspaceTodos[0]).toMatchObject({
      filePath: `${ROOT}/a.ts`,
      relativePath: "a.ts",
      tag: "TODO",
    });
    expect(harness.hook().workspaceTodosLoading).toBe(false);

    act(() => {
      harness.hook().closeTodoPanel();
    });

    expect(harness.hook().todoPanelOpen).toBe(false);

    harness.unmount();
  });

  it("skips directories in the skip list and non-source files during the scan", async () => {
    const readDirectory = directoryTree({
      [ROOT]: [
        directoryEntry(`${ROOT}/node_modules`, "node_modules"),
        fileEntry(`${ROOT}/data.bin`, "data.bin"),
        fileEntry(`${ROOT}/index.ts`, "index.ts"),
      ],
      [`${ROOT}/node_modules`]: [fileEntry(`${ROOT}/node_modules/lib.ts`)],
    });
    const readTextFile = vi.fn(async (path: string) =>
      path.endsWith("index.ts") ? "// TODO: real one" : "// TODO: should never be read",
    );
    const harness = renderWorkspaceTodos({
      workspaceFiles: createFakeWorkspaceFiles({ readDirectory, readTextFile }),
    });

    await act(async () => {
      await harness.hook().refreshWorkspaceTodos();
    });

    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(readTextFile).toHaveBeenCalledWith(`${ROOT}/index.ts`);
    expect(harness.hook().workspaceTodos).toHaveLength(1);
    expect(harness.hook().workspaceTodos[0].relativePath).toBe("index.ts");

    harness.unmount();
  });

  it("opens a TODO through openNavigationTarget with a 1:1 line/column mapping", async () => {
    const harness = renderWorkspaceTodos();

    await act(async () => {
      await harness.hook().openWorkspaceTodo({
        column: 4,
        filePath: `${ROOT}/a.ts`,
        line: 10,
        relativePath: "a.ts",
        tag: "FIXME",
        text: "fix this",
      });
    });

    expect(harness.openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/a.ts`,
      { column: 4, lineNumber: 10 },
      "FIXME",
    );

    harness.unmount();
  });

  it("toggles the panel open (scanning) and closed without a rescan", async () => {
    const readDirectory = directoryTree({ [ROOT]: [] });
    const harness = renderWorkspaceTodos({
      workspaceFiles: createFakeWorkspaceFiles({ readDirectory }),
    });

    await act(async () => {
      harness.hook().toggleTodoPanel();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.hook().todoPanelOpen).toBe(true);
    expect(readDirectory).toHaveBeenCalledTimes(1);

    act(() => {
      harness.hook().toggleTodoPanel();
    });

    expect(harness.hook().todoPanelOpen).toBe(false);
    expect(readDirectory).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("resetWorkspaceTodos clears the panel, list, and loading flag in one call", async () => {
    const readDirectory = directoryTree({
      [ROOT]: [fileEntry(`${ROOT}/a.ts`)],
    });
    const readTextFile = vi.fn(async () => "// TODO: one");
    const harness = renderWorkspaceTodos({
      workspaceFiles: createFakeWorkspaceFiles({ readDirectory, readTextFile }),
    });

    await act(async () => {
      harness.hook().openTodoPanel();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.hook().workspaceTodos).toHaveLength(1);

    act(() => {
      harness.hook().resetWorkspaceTodos();
    });

    expect(harness.hook().todoPanelOpen).toBe(false);
    expect(harness.hook().workspaceTodos).toEqual([]);
    expect(harness.hook().workspaceTodosLoading).toBe(false);

    harness.unmount();
  });

  it("drops a scan result whose workspace root changed mid-flight", async () => {
    const deferred = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(() => deferred.promise);
    const harness = renderWorkspaceTodos({
      workspaceFiles: createFakeWorkspaceFiles({ readDirectory }),
    });

    let refreshPromise: Promise<void> | null = null;
    act(() => {
      refreshPromise = harness.hook().refreshWorkspaceTodos();
    });

    await act(async () => {
      // The active tab switched away before the directory listing resolves.
      harness.ref.current = "/other";
      deferred.resolve([fileEntry(`${ROOT}/a.ts`)]);
      await refreshPromise;
    });

    // The core isolation guarantee under test: a stale scan can never splash
    // another workspace's TODOs into this tab. (The loading flag is left as-is
    // by this early-return guard, matching the pre-extraction behaviour; a real
    // workspace switch always resets it via `resetWorkspaceTodos`.)
    expect(harness.hook().workspaceTodos).toEqual([]);

    harness.unmount();
  });

  it("caps the scan at the max file count so a huge tree never blocks the UI", async () => {
    const manyFiles = Array.from({ length: 2001 }, (_, index) =>
      fileEntry(`${ROOT}/file${index}.ts`),
    );
    const readDirectory = directoryTree({ [ROOT]: manyFiles });
    const readTextFile = vi.fn(async () => "// TODO: one");
    const harness = renderWorkspaceTodos({
      workspaceFiles: createFakeWorkspaceFiles({ readDirectory, readTextFile }),
    });

    await act(async () => {
      await harness.hook().refreshWorkspaceTodos();
    });

    expect(readTextFile).toHaveBeenCalledTimes(2000);

    harness.unmount();
  });
});
