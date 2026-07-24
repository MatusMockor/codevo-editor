// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEditorConfig, type EditorConfigFile } from "../domain/editorConfig";
import {
  loadWorkbenchEditorConfigFile,
  resolveWorkbenchEditorConfigForFile,
  useWorkbenchEditorConfigCoordinator,
  type WorkbenchEditorConfigLoadDependencies,
} from "./useWorkbenchEditorConfigCoordinator";

afterEach(() => {
  document.body.replaceChildren();
});

function editorConfig(directory: string, content: string): EditorConfigFile {
  return { directory, parsed: parseEditorConfig(content) };
}

describe("workbench EditorConfig coordinator", () => {
  it("resolves the deepest cascade and stops after root=true", async () => {
    const filesByDirectory: Record<string, EditorConfigFile | null> = {
      "/workspace/src/deep": editorConfig("/workspace/src/deep", "[*]\nindent_size = 2\n"),
      "/workspace/src": editorConfig("/workspace/src", "root = true\n[*]\nindent_style = space\n"),
    };
    const loadFile = vi.fn(
      async (_rootPath: string, directory: string) => filesByDirectory[directory] ?? null,
    );

    await expect(
      resolveWorkbenchEditorConfigForFile(
        { isRequestCurrent: () => true, loadFile },
        { filePath: "/workspace/src/deep/file.ts", rootPath: "/workspace" },
      ),
    ).resolves.toMatchObject({ indentSize: 2, indentStyle: "space" });
    expect(loadFile.mock.calls.map(([, directory]) => directory)).toEqual([
      "/workspace/src/deep",
      "/workspace/src",
    ]);
  });

  it("drops a cascade when its workspace becomes stale between reads", async () => {
    let current = true;
    const loadFile = vi.fn(async (_rootPath: string, directory: string) => {
      current = false;
      return editorConfig(directory, "[*]\nindent_size = 8\n");
    });

    await expect(
      resolveWorkbenchEditorConfigForFile(
        { isRequestCurrent: () => current, loadFile },
        { filePath: "/workspace/src/file.ts", rootPath: "/workspace" },
      ),
    ).resolves.toEqual({});
    expect(loadFile).toHaveBeenCalledOnce();
  });

  it("drops an entire cascade when its cache generation changes between reads", async () => {
    let generation = "0:0";
    const loadFile = vi.fn(async (_rootPath: string, directory: string) => {
      if (directory === "/workspace/src") generation = "0:1";
      return editorConfig(directory, "[*]\nindent_size = 8\n");
    });

    await expect(
      resolveWorkbenchEditorConfigForFile(
        {
          cacheGeneration: () => generation,
          isRequestCurrent: () => true,
          loadFile,
        },
        { filePath: "/workspace/src/file.ts", rootPath: "/workspace" },
      ),
    ).resolves.toEqual({});
    expect(loadFile).toHaveBeenCalledOnce();
  });

  it("does not repopulate an invalidated cache from an older in-flight read", async () => {
    let generation = "0:0";
    let finishRead!: (content: string) => void;
    const cache = {};
    const pending = loadWorkbenchEditorConfigFile(
      {
        cache: () => cache,
        cacheGeneration: () => generation,
        currentWorkspaceRoot: () => "/workspace",
        readTextFile: () =>
          new Promise<string>((resolve) => {
            finishRead = resolve;
          }),
        resolveWorkspaceRuntimeOwner: () => null,
      },
      { directory: "/workspace", rootPath: "/workspace" },
    );

    generation = "0:1";
    finishRead("root=true\n[*]\nindent_size=8");

    await expect(pending).resolves.toBeNull();
    expect(cache).toEqual({ "/workspace": {} });
  });

  it("immediately unpublishes the previous document config while the next request is pending", async () => {
    const reads = deferredEditorConfigReads();
    const activeDocumentRef = { current: { path: "/workspace/a/file.ts" } };
    const currentWorkspaceRootRef = { current: "/workspace" };
    const resolveWorkspaceRuntimeOwner = () => null;
    let activeDocumentPath = activeDocumentRef.current.path;
    let coordinator!: ReturnType<typeof useWorkbenchEditorConfigCoordinator>;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const Harness = () => {
      coordinator = useWorkbenchEditorConfigCoordinator({
        activeDocumentPath,
        activeDocumentRef,
        currentWorkspaceRootRef,
        readTextFile: reads.readTextFile,
        resolveWorkspaceRuntimeOwner,
        workspaceRoot: "/workspace",
      });
      return null;
    };
    const render = () => root.render(createElement(Harness));

    act(() => render());
    await act(async () =>
      reads.resolve("/workspace/a/.editorconfig", "root=true\n[*]\nindent_size=2"),
    );
    expect(coordinator.activeEditorConfig.indentSize).toBe(2);

    activeDocumentPath = "/workspace/b/file.ts";
    activeDocumentRef.current = { path: activeDocumentPath };
    await act(async () => render());

    expect(coordinator.activeEditorConfig).toEqual({});
    expect(coordinator.activeEditorConfigRef.current).toEqual({});

    await act(async () =>
      reads.resolve("/workspace/b/.editorconfig", "root=true\n[*]\nindent_size=4"),
    );
    expect(coordinator.activeEditorConfig.indentSize).toBe(4);
    await act(async () => root.unmount());
  });

  it("invalidates cached misses and republishes the active config on refresh", async () => {
    let content: string | null = null;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === "/workspace/.editorconfig" && content !== null) return content;
      throw new Error("missing");
    });
    const activeDocumentRef = { current: { path: "/workspace/file.ts" } };
    const currentWorkspaceRootRef = { current: "/workspace" };
    const resolveWorkspaceRuntimeOwner = () => null;
    let coordinator!: ReturnType<typeof useWorkbenchEditorConfigCoordinator>;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const Harness = () => {
      coordinator = useWorkbenchEditorConfigCoordinator({
        activeDocumentPath: activeDocumentRef.current.path,
        activeDocumentRef,
        currentWorkspaceRootRef,
        readTextFile,
        resolveWorkspaceRuntimeOwner,
        workspaceRoot: "/workspace",
      });
      return null;
    };

    await act(async () => root.render(createElement(Harness)));
    expect(coordinator.activeEditorConfig).toEqual({});
    content = "root=true\n[*]\nindent_size=6";
    await act(async () => coordinator.refreshRoot("/workspace"));
    await act(async () => undefined);

    expect(coordinator.activeEditorConfig.indentSize).toBe(6);
    expect(readTextFile).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("invalidates a workspace cache when that workspace becomes active again", async () => {
    const contentByPath: Record<string, string> = {
      "/workspace-a/.editorconfig": "root=true\n[*]\nindent_size=2",
      "/workspace-b/.editorconfig": "root=true\n[*]\nindent_size=4",
    };
    const readTextFile = vi.fn(async (path: string) => {
      const content = contentByPath[path];
      if (content === undefined) throw new Error("missing");
      return content;
    });
    const activeDocumentRef = { current: { path: "/workspace-a/file.ts" } };
    const currentWorkspaceRootRef = { current: "/workspace-a" as string | null };
    const resolveWorkspaceRuntimeOwner = () => null;
    let activeDocumentPath = activeDocumentRef.current.path;
    let workspaceRoot = currentWorkspaceRootRef.current;
    let coordinator!: ReturnType<typeof useWorkbenchEditorConfigCoordinator>;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const Harness = () => {
      coordinator = useWorkbenchEditorConfigCoordinator({
        activeDocumentPath,
        activeDocumentRef,
        currentWorkspaceRootRef,
        readTextFile,
        resolveWorkspaceRuntimeOwner,
        workspaceRoot,
      });
      return null;
    };
    const render = async () => {
      await act(async () => root.render(createElement(Harness)));
      await act(async () => undefined);
    };

    await render();
    expect(coordinator.activeEditorConfig.indentSize).toBe(2);

    workspaceRoot = "/workspace-b";
    currentWorkspaceRootRef.current = workspaceRoot;
    activeDocumentPath = "/workspace-b/file.ts";
    activeDocumentRef.current = { path: activeDocumentPath };
    await render();
    expect(coordinator.activeEditorConfig.indentSize).toBe(4);

    contentByPath["/workspace-a/.editorconfig"] = "root=true\n[*]\nindent_size=6";
    workspaceRoot = "/workspace-a";
    currentWorkspaceRootRef.current = workspaceRoot;
    activeDocumentPath = "/workspace-a/file.ts";
    activeDocumentRef.current = { path: activeDocumentPath };
    await render();

    expect(coordinator.activeEditorConfig.indentSize).toBe(6);
    expect(readTextFile).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });
});

function deferredEditorConfigReads() {
  const pending = new Map<string, (content: string) => void>();
  const readTextFile: WorkbenchEditorConfigLoadDependencies["readTextFile"] = vi.fn(
    (path: string) => new Promise<string>((resolve) => pending.set(path, resolve)),
  );
  return {
    readTextFile,
    resolve(path: string, content: string) {
      const resolve = pending.get(path);
      if (!resolve) throw new Error(`No pending EditorConfig read for ${path}`);
      pending.delete(path);
      resolve(content);
    },
  };
}
