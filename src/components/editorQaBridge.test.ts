// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { installEditorQaBridge } from "./editorQaBridge";

const HOME = "/Users/me";
const MAC_HOME = { path: HOME, pathCase: "insensitive" } as const;

type BridgeDependencies = Parameters<typeof installEditorQaBridge>[0];

describe("editorQaBridge openWorkspaceRoot", () => {
  let uninstall: (() => void) | null = null;

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it.each([HOME, `${HOME}/`, "/", "/Users"])("refuses %s before opening it", async (path) => {
    const harness = install({ resolveWorkspaceHome: async () => MAC_HOME });

    await expect(window.__codevoQa?.openWorkspaceRoot(path)).resolves.toBe(false);

    expect(harness.openWorkspaceRoot).not.toHaveBeenCalled();
    expect(harness.root()).toBe("/workspace");
  });

  it("opens a project folder inside home", async () => {
    const harness = install({ resolveWorkspaceHome: async () => MAC_HOME });

    await expect(window.__codevoQa?.openWorkspaceRoot(`${HOME}/Developer/app`)).resolves.toBe(true);

    expect(harness.openWorkspaceRoot).toHaveBeenCalledExactlyOnceWith(`${HOME}/Developer/app`);
  });

  it("still refuses the filesystem root when home cannot be resolved", async () => {
    const harness = install({
      resolveWorkspaceHome: () => Promise.reject(new Error("home unavailable")),
    });

    await expect(window.__codevoQa?.openWorkspaceRoot("/")).resolves.toBe(false);
    expect(harness.openWorkspaceRoot).not.toHaveBeenCalled();

    await expect(window.__codevoQa?.openWorkspaceRoot(HOME)).resolves.toBe(true);
    expect(harness.openWorkspaceRoot).toHaveBeenCalledExactlyOnceWith(HOME);
  });

  it("refuses the filesystem root with the default resolver outside the native runtime", async () => {
    const harness = install({});

    await expect(window.__codevoQa?.openWorkspaceRoot("//")).resolves.toBe(false);

    expect(harness.openWorkspaceRoot).not.toHaveBeenCalled();
  });

  it("compares the home folder exactly on a case-sensitive host", async () => {
    const harness = install({
      resolveWorkspaceHome: async () => ({ path: "/home/me", pathCase: "sensitive" }),
    });

    await expect(window.__codevoQa?.openWorkspaceRoot("/home/me")).resolves.toBe(false);
    expect(harness.openWorkspaceRoot).not.toHaveBeenCalled();
    await expect(window.__codevoQa?.openWorkspaceRoot("/home/Me")).resolves.toBe(true);
    expect(harness.openWorkspaceRoot).toHaveBeenCalledExactlyOnceWith("/home/Me");
  });

  it("folds case when refusing the home folder on a case-insensitive host", async () => {
    const harness = install({
      resolveWorkspaceHome: async () => ({ path: "/home/me", pathCase: "insensitive" }),
    });

    await expect(window.__codevoQa?.openWorkspaceRoot("/home/Me")).resolves.toBe(false);
    expect(harness.openWorkspaceRoot).not.toHaveBeenCalled();
  });

  function install(overrides: Pick<BridgeDependencies, "resolveWorkspaceHome">): {
    readonly openWorkspaceRoot: ReturnType<typeof vi.fn<(path: string) => Promise<boolean>>>;
    root(): string | null;
  } {
    let workspaceRoot: string | null = "/workspace";
    const openWorkspaceRoot = vi.fn<(path: string) => Promise<boolean>>(async (path) => {
      workspaceRoot = path;
      return true;
    });
    uninstall = installEditorQaBridge({
      diagnosticsByPath: () => ({}),
      editor: () => null,
      getActiveDocument: () => null,
      getWorkspaceRoot: () => workspaceRoot,
      openWorkspaceRoot,
      provideBladeCompletions: async () => [],
      provideBladeDefinition: async () => false,
      provideLatteCompletions: async () => [],
      provideLatteDefinition: async () => false,
      provideNeonCompletions: async () => [],
      provideNeonDefinition: async () => false,
      providePhpFrameworkDefinition: async () => false,
      providePhpMethodCompletions: async () => [],
      providePhpPresenterLinkDefinition: async () => false,
      ...overrides,
    });
    return { openWorkspaceRoot, root: () => workspaceRoot };
  }
});
