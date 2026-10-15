// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaletteBranchSource } from "../commandPalette/commandPaletteProvider";
import {
  AGENT_BRANCH_SOURCE_STALE_REASON,
  AGENT_BRANCH_SWITCH_BUSY_REASON,
  useAgentPaletteBranchSource,
  type AgentPaletteBranchOwner,
  type AgentPaletteBranchSourceOptions,
} from "./useAgentPaletteBranchSource";

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function gitGateway() {
  return {
    branchList: vi.fn(async () => [
      { isCurrent: true, name: "main" },
      { isCurrent: false, name: "feature" },
    ]),
    checkoutRemoteBranch: vi.fn(async () => []),
    remoteBranchList: vi.fn(async () => [{ isCurrent: false, name: "origin/release" }]),
    switchBranch: vi.fn(async () => undefined),
  } satisfies AgentPaletteBranchSourceOptions["gitGateway"];
}

function renderSource(
  initialOwner: AgentPaletteBranchOwner | null,
  overrides: Partial<AgentPaletteBranchSourceOptions> = {},
) {
  const currentWorkspaceRootRef = { current: initialOwner?.rootPath ?? null };
  const gateway = gitGateway();
  const refreshGitStatus = vi.fn(async () => undefined);
  const captured: { current: PaletteBranchSource | null } = { current: null };
  function Probe({ owner }: { readonly owner: AgentPaletteBranchOwner | null }) {
    captured.current = useAgentPaletteBranchSource({
      checkoutGuard: () => null,
      currentWorkspaceRootRef,
      gitGateway: gateway,
      owner,
      refreshGitStatus,
      ...overrides,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe owner={initialOwner} />));
  unmounts.push(() => act(() => root.unmount()));
  return {
    gateway,
    refreshGitStatus,
    source: () => captured.current,
    switchTo: (owner: AgentPaletteBranchOwner | null) => {
      currentWorkspaceRootRef.current = owner?.rootPath ?? null;
      act(() => root.render(<Probe owner={owner} />));
    },
  };
}

describe("useAgentPaletteBranchSource", () => {
  it("lists local and remote branches of the active project and switches through git", async () => {
    const harness = renderSource({ rootPath: "/workspace-a" });
    const source = harness.source();

    expect(source?.scopeKey).toBe("/workspace-a");
    expect(source?.scopeLabel).toBe("workspace-a");
    await expect(source?.load()).resolves.toEqual([
      { current: true, name: "main", remote: false },
      { current: false, name: "feature", remote: false },
      { current: false, name: "origin/release", remote: true },
    ]);

    await act(async () => source?.switchTo({ current: false, name: "feature", remote: false }));
    expect(harness.gateway.switchBranch).toHaveBeenCalledExactlyOnceWith("/workspace-a", "feature");
    expect(harness.refreshGitStatus).toHaveBeenCalledOnce();

    await act(async () =>
      source?.switchTo({ current: false, name: "origin/release", remote: true }),
    );
    expect(harness.gateway.checkoutRemoteBranch).toHaveBeenCalledExactlyOnceWith(
      "/workspace-a",
      "origin/release",
    );
  });

  it("offers no source without a project", () => {
    expect(renderSource(null).source()).toBeNull();
  });

  it("refuses a source captured for A after A to B to A", async () => {
    const firstA = { rootPath: "/workspace-a" };
    const harness = renderSource(firstA);
    const stale = harness.source();

    harness.switchTo({ rootPath: "/workspace-b" });
    harness.switchTo({ rootPath: "/workspace-a" });

    await expect(stale?.load()).rejects.toThrow(AGENT_BRANCH_SOURCE_STALE_REASON);
    await expect(
      stale?.switchTo({ current: false, name: "feature", remote: false }),
    ).rejects.toThrow(AGENT_BRANCH_SOURCE_STALE_REASON);
    expect(harness.gateway.switchBranch).not.toHaveBeenCalled();
    expect(harness.source()).not.toBe(stale);
  });

  it("does not refresh status for a project that changed while the switch ran", async () => {
    const harness = renderSource({ rootPath: "/workspace-a" });
    let finish!: () => void;
    harness.gateway.switchBranch.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))),
    );
    const source = harness.source();
    let switching!: Promise<void> | undefined;
    act(() => {
      switching = source?.switchTo({ current: false, name: "feature", remote: false });
    });
    await expect(source?.switchTo({ current: false, name: "main", remote: false })).rejects.toThrow(
      AGENT_BRANCH_SWITCH_BUSY_REASON,
    );

    harness.switchTo({ rootPath: "/workspace-b" });
    await act(async () => {
      finish();
      await switching;
    });

    expect(harness.refreshGitStatus).not.toHaveBeenCalled();
  });

  it("refuses the switch with the agent checkout guard reason", async () => {
    const harness = renderSource(
      { rootPath: "/workspace-a" },
      { checkoutGuard: () => "An agent turn is running in this checkout." },
    );

    await expect(
      harness.source()?.switchTo({ current: false, name: "feature", remote: false }),
    ).rejects.toThrow("An agent turn is running in this checkout.");
    expect(harness.gateway.switchBranch).not.toHaveBeenCalled();
  });
});
