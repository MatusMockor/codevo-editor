import { describe, expect, it, vi } from "vitest";
import type { GitBranch } from "../../domain/git";
import {
  editorBranchSource,
  editorPaletteProjects,
  editorPaletteScripts,
} from "./editorPaletteSources";

describe("editor palette sources", () => {
  it("turns workspace tabs into projects and marks the active root", () => {
    expect(editorPaletteProjects(["/u/orders-api", "/u/web-dashboard/"], "/u/orders-api")).toEqual([
      { key: "/u/orders-api", label: "orders-api", path: "/u/orders-api", current: true },
      {
        key: "/u/web-dashboard/",
        label: "web-dashboard",
        path: "/u/web-dashboard/",
        current: false,
      },
    ]);
  });

  it("describes node scripts with their package manager and runnable state", () => {
    const scripts = editorPaletteScripts(
      [
        {
          key: "k",
          manifestRelativePath: "package.json",
          packageName: null,
          packageManager: "pnpm",
          packageRootRelativePath: "",
          scriptName: "test",
        },
      ],
      (commandId) => commandId === "script.node.k",
    );
    expect(scripts).toEqual([{ key: "k", name: "test", detail: "pnpm run test", runnable: true }]);
  });

  it("lists local and remote branches straight from the gateway without panel state", async () => {
    const branchList = vi.fn(async (): Promise<GitBranch[]> => [{ name: "main", isCurrent: true }]);
    const remoteBranchList = vi.fn(async (): Promise<GitBranch[]> => [
      { name: "origin/feat", isCurrent: false },
    ]);
    const source = editorBranchSource({
      root: "/u/orders-api",
      listing: { branchList, remoteBranchList },
      switchGitBranch: vi.fn(async () => undefined),
      checkoutRemoteBranch: vi.fn(async () => undefined),
    });

    expect(source.scopeLabel).toBe("orders-api");
    expect(await source.load()).toEqual([
      { name: "main", current: true, remote: false },
      { name: "origin/feat", current: false, remote: true },
    ]);
    expect(branchList).toHaveBeenCalledWith("/u/orders-api");
    expect(remoteBranchList).toHaveBeenCalledWith("/u/orders-api");
  });

  it("rejects with the gateway error for a folder that is not a git repository", async () => {
    const source = editorBranchSource({
      root: "/u/plain-folder",
      listing: { branchList: async () => Promise.reject(new Error("not a git repository")) },
      switchGitBranch: vi.fn(async () => undefined),
      checkoutRemoteBranch: vi.fn(async () => undefined),
    });

    await expect(source.load()).rejects.toThrow("not a git repository");
  });

  it("switches local branches directly and checks out remote ones", async () => {
    const switchGitBranch = vi.fn(async () => undefined);
    const checkoutRemoteBranch = vi.fn(async () => undefined);
    const source = editorBranchSource({
      root: "/u/orders-api",
      listing: { branchList: async () => [] },
      switchGitBranch,
      checkoutRemoteBranch,
    });

    await source.switchTo({ name: "main", current: false, remote: false });
    await source.switchTo({ name: "origin/feat", current: false, remote: true });

    expect(switchGitBranch).toHaveBeenCalledWith("main");
    expect(checkoutRemoteBranch).toHaveBeenCalledWith("origin/feat");
  });
});
