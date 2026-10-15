import { describe, expect, it, vi } from "vitest";
import {
  detectAgentScriptsWorkspace,
  SCRIPTS_WORKSPACE_NESTED_DIRECTORY_LIMIT,
  SCRIPTS_WORKSPACE_ROOT_ENTRY_LIMIT,
  scriptsWorkspaceFromRootEntries,
  scriptsWorkspaceHasJavaScriptTypeScript,
  stopAgentWorkspaceRuntimes,
} from "./agentWorkspaceRuntimes";

const file = (name: string) => ({ kind: "file" as const, name, path: `/root/${name}` });

describe("agent workspace runtimes", () => {
  it("disposes the workspace root without touching terminals when disposal succeeds", async () => {
    const gateways = {
      runtimeLifecycle: { disposeWorkspace: vi.fn(async () => undefined) },
      terminal: { stopRoot: vi.fn(async () => undefined) },
    };
    const reportError = vi.fn();

    await expect(
      stopAgentWorkspaceRuntimes(gateways, {
        isCurrent: () => true,
        reportError,
        rootPath: "/root",
      }),
    ).resolves.toBe("stopped");
    expect(gateways.terminal.stopRoot).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("falls back to stopping root terminals and reports an incomplete disposal", async () => {
    const failure = new Error("dispose failed");
    const gateways = {
      runtimeLifecycle: { disposeWorkspace: vi.fn(async () => Promise.reject(failure)) },
      terminal: { stopRoot: vi.fn(async () => undefined) },
    };
    const reportError = vi.fn();

    await expect(
      stopAgentWorkspaceRuntimes(gateways, {
        isCurrent: () => true,
        reportError,
        rootPath: "/root",
      }),
    ).resolves.toBe("incomplete");
    expect(gateways.terminal.stopRoot).toHaveBeenCalledExactlyOnceWith("/root");
    expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("skips the terminal fallback when the owner changed while disposal was failing", async () => {
    const current = { value: true };
    const gateways = {
      runtimeLifecycle: {
        disposeWorkspace: vi.fn(async () => {
          current.value = false;
          throw new Error("stale dispose failed");
        }),
      },
      terminal: { stopRoot: vi.fn(async () => undefined) },
    };
    const reportError = vi.fn();

    await expect(
      stopAgentWorkspaceRuntimes(gateways, {
        isCurrent: () => current.value,
        reportError,
        rootPath: "/root",
      }),
    ).resolves.toBe("stale");
    expect(gateways.terminal.stopRoot).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("classifies the scripts workspace from bounded root entries", () => {
    expect(scriptsWorkspaceFromRootEntries([file("tsconfig.json")], false)).toBe(
      "javaScriptTypeScript",
    );
    expect(
      scriptsWorkspaceFromRootEntries(
        [{ kind: "directory", name: "package.json", path: "/root/package.json" }],
        false,
      ),
    ).toBe("none");
    expect(scriptsWorkspaceFromRootEntries([file("README.md")], true)).toBe("unknown");
    expect(scriptsWorkspaceHasJavaScriptTypeScript("unknown")).toBe(true);
    expect(scriptsWorkspaceHasJavaScriptTypeScript("none")).toBe(false);
  });

  it("reads the root listing with the bounded entry limit", async () => {
    const reader = {
      readDirectoryBounded: vi.fn(async () => ({
        entries: [file("package.json")],
        truncated: false,
      })),
    };

    await expect(detectAgentScriptsWorkspace(reader, "/root")).resolves.toBe(
      "javaScriptTypeScript",
    );
    expect(reader.readDirectoryBounded).toHaveBeenCalledExactlyOnceWith(
      "/root",
      SCRIPTS_WORKSPACE_ROOT_ENTRY_LIMIT,
    );
  });

  it("finds a nested package such as packages/web/package.json", async () => {
    const tree: Record<string, ReturnType<typeof entry>[]> = {
      "/root": [entry("directory", "/root/packages"), entry("file", "/root/README.md")],
      "/root/packages": [entry("directory", "/root/packages/web")],
      "/root/packages/web": [entry("file", "/root/packages/web/package.json")],
    };
    const reader = treeReader(tree);

    await expect(detectAgentScriptsWorkspace(reader, "/root")).resolves.toBe(
      "javaScriptTypeScript",
    );
  });

  it("skips dependency and hidden directories and stays bounded in depth", async () => {
    const tree: Record<string, ReturnType<typeof entry>[]> = {
      "/root": [
        entry("directory", "/root/node_modules"),
        entry("directory", "/root/.cache"),
        entry("directory", "/root/a"),
      ],
      "/root/node_modules": [entry("file", "/root/node_modules/package.json")],
      "/root/.cache": [entry("file", "/root/.cache/package.json")],
      "/root/a": [entry("directory", "/root/a/b")],
      "/root/a/b": [entry("directory", "/root/a/b/c")],
      "/root/a/b/c": [entry("file", "/root/a/b/c/package.json")],
    };
    const reader = treeReader(tree);

    await expect(detectAgentScriptsWorkspace(reader, "/root")).resolves.toBe("none");
    expect(reader.readDirectoryBounded.mock.calls.map(([path]) => path)).toEqual([
      "/root",
      "/root/a",
      "/root/a/b",
    ]);
  });

  it("reports an unknown workspace once the nested directory budget is spent", async () => {
    const directories = Array.from(
      { length: SCRIPTS_WORKSPACE_NESTED_DIRECTORY_LIMIT + 1 },
      (_, index) => entry("directory", `/root/d${index}`),
    );
    const reader = treeReader({ "/root": directories });

    await expect(detectAgentScriptsWorkspace(reader, "/root")).resolves.toBe("unknown");
    expect(reader.readDirectoryBounded).toHaveBeenCalledTimes(
      SCRIPTS_WORKSPACE_NESTED_DIRECTORY_LIMIT + 1,
    );
  });
});

function entry(kind: "directory" | "file", path: string) {
  return { kind, name: path.slice(path.lastIndexOf("/") + 1), path };
}

function treeReader(tree: Record<string, readonly ReturnType<typeof entry>[]>) {
  return {
    readDirectoryBounded: vi.fn(async (path: string, _maxEntries: number) => ({
      entries: tree[path] ?? [],
      truncated: false,
    })),
  };
}
