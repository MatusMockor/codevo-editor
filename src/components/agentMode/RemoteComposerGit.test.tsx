// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../../contracts/remote-git-sync-wire.json";
import type { RemoteComposerGit } from "../../application/useRemoteDraftGitBase";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import { HEAD_WORKTREE_BASE, type AgentWorktreeBase } from "../../domain/agentWorktreeBase";
import { remoteOriginBase } from "../../domain/remoteDraftGitBase";
import {
  remoteGitErrorMessage,
  type RemoteGitBranchList,
  type RemoteGitCheckoutStatus,
  type RemoteGitOperation,
  type RemoteGitSyncPort,
} from "../../domain/remoteGitSync";
import { AgentComposerDrawerEnd } from "./AgentComposerDrawerEnd";
import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";
import type { AgentStartedThreadBranch } from "./useAgentStartedThreadBranch";

type Contract = Readonly<{
  sections: Readonly<
    Record<string, Readonly<{ accepted: readonly { name: string; value: unknown }[] }>>
  >;
}>;
const contract = wireContract as unknown as Contract;
const fixture = <T,>(section: string, name: string): T =>
  contract.sections[section]!.accepted.find((entry) => entry.name === name)!.value as T;

const typical = fixture<RemoteGitBranchList>("branchList", "typical");
const truncated = fixture<RemoteGitBranchList>("branchList", "truncated");
const cleanTracking = fixture<RemoteGitCheckoutStatus>("checkoutStatus", "cleanTracking");
const dirtyAtLimit = fixture<RemoteGitCheckoutStatus>("checkoutStatus", "dirtyAtLimit");
const detachedRebasing = fixture<RemoteGitCheckoutStatus>("checkoutStatus", "detachedRebasing");

const running = (kind: "fetch" | "update"): RemoteGitOperation => ({
  id: "5f0c1d2e-3a4b-4c5d-9e6f-7a8b9c0d1e2f",
  kind,
  status: "running",
  error: null,
  result: null,
});

function fakePort(list = typical, checkout = cleanTracking) {
  return {
    branches: vi.fn().mockResolvedValue(list),
    projectStatus: vi.fn().mockResolvedValue(checkout),
    fetch: vi.fn().mockResolvedValue({ kind: "accepted", value: running("fetch") }),
    update: vi.fn().mockResolvedValue({ kind: "accepted", value: running("update") }),
    threadStatus: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    pollOperation: vi.fn(),
    awaitOperation: vi.fn().mockResolvedValue({
      kind: "succeeded",
      result: { kind: "fetch", fetchedAt: "2026-10-02T09:15:00Z" },
    }),
  } satisfies RemoteGitSyncPort;
}

const STARTED_NONE: AgentStartedThreadBranch = {
  branch: { kind: "none" },
  picker: null,
  currentBranch: null,
  notice: null,
};
const STARTED_SERVER_CHECKOUT: AgentStartedThreadBranch = {
  ...STARTED_NONE,
  branch: { kind: "serverCheckout" },
};

function remoteGit(port: RemoteGitSyncPort, revision = "turn-1"): RemoteComposerGit {
  return {
    key: JSON.stringify(["linux", "linux-runner", "app"]),
    revision,
    port,
    project: { serverId: "linux", runnerId: "linux-runner", projectId: "app" },
  };
}

interface HarnessProps {
  readonly git: RemoteComposerGit | null;
  readonly isolation: AgentTaskIsolation;
  readonly locked?: boolean;
  readonly started?: AgentStartedThreadBranch;
  readonly onBase: (base: AgentWorktreeBase) => void;
}

function Harness({ git, isolation, locked = false, onBase, started = STARTED_NONE }: HarnessProps) {
  const [base, setBase] = useState<AgentWorktreeBase>(HEAD_WORKTREE_BASE);
  const context: AgentComposerDrawerContext = {
    repositoryRoot: "remote:linux:linux-runner:app",
    isolation,
    locked,
    disabled: false,
    remote: true,
    worktreeBase: base,
    remoteGit: git,
    onWorktreeBaseChange: (next) => {
      onBase(next);
      setBase(next);
    },
  };
  return <AgentComposerDrawerEnd checkout={null} context={context} started={started} />;
}

function button(name: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label^="${name}"]`);
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === text,
    ) ?? null
  );
}

function options(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

function typeInto(input: HTMLInputElement | null, value: string): void {
  if (input === null) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("remote composer Git controls", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  async function render(props: Omit<HarnessProps, "onBase">, onBase = vi.fn()) {
    await act(async () => {
      root.render(<Harness {...props} onBase={onBase} />);
    });
    return onBase;
  }

  async function click(target: HTMLElement | null): Promise<void> {
    await act(async () => {
      target?.click();
    });
  }

  it("preselects the origin default branch for a new server worktree", async () => {
    const port = fakePort();
    const onBase = await render({ git: remoteGit(port), isolation: "worktree" });
    expect(port.branches).toHaveBeenCalledWith(remoteGit(port).project);
    expect(onBase).toHaveBeenCalledWith(remoteOriginBase("main"));
    expect(button("Start from")?.textContent).toContain("From origin/main");
  });

  it("fetches on open and lists the server checkout before the origin branches", async () => {
    const port = fakePort();
    await render({ git: remoteGit(port), isolation: "worktree" });
    await click(button("Start from"));
    expect(port.fetch).toHaveBeenCalledTimes(1);
    expect(port.awaitOperation).toHaveBeenCalledTimes(1);
    expect(options().map((option) => option.textContent)).toEqual([
      "Current server checkoutmain",
      "maindefault",
      "feature/checkout-v2",
    ]);
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(document.body.textContent).toContain("Fetched");
  });

  it("keeps an explicit server checkout choice instead of the default branch", async () => {
    const port = fakePort();
    const onBase = await render({ git: remoteGit(port), isolation: "worktree" });
    await click(button("Start from"));
    await click(options()[0] ?? null);
    expect(onBase).toHaveBeenLastCalledWith(HEAD_WORKTREE_BASE);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onBase).toHaveBeenLastCalledWith(HEAD_WORKTREE_BASE);
    expect(button("Start from")?.textContent).toContain("From Server checkout");
  });

  it("searches origin branches and chooses one", async () => {
    const port = fakePort();
    const onBase = await render({ git: remoteGit(port), isolation: "worktree" });
    await click(button("Start from"));
    await act(async () => {
      typeInto(document.querySelector('input[aria-label="Search origin branches"]'), "checkout");
    });
    expect(options().map((option) => option.textContent)).toEqual([
      "Current server checkoutmain",
      "feature/checkout-v2",
    ]);
    await click(options()[1] ?? null);
    expect(onBase).toHaveBeenLastCalledWith(remoteOriginBase("feature/checkout-v2"));
    expect(button("Start from")?.textContent).toContain("From origin/feature/checkout-v2");
  });

  it("says when the branch list is truncated", async () => {
    const port = fakePort(truncated);
    await render({ git: remoteGit(port), isolation: "worktree" });
    await click(button("Start from"));
    expect(document.body.textContent).toContain("Only the 500 most recent branches are listed.");
  });

  it("reports a refused fetch with the runner error copy", async () => {
    const port = fakePort();
    port.fetch.mockResolvedValue({ kind: "refused", error: "git_auth_failed" });
    await render({ git: remoteGit(port), isolation: "worktree" });
    await click(button("Start from"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      remoteGitErrorMessage("git_auth_failed"),
    );
  });

  it("shows ahead/behind for the server checkout and updates it from origin", async () => {
    const port = fakePort();
    port.awaitOperation.mockResolvedValue({
      kind: "succeeded",
      result: {
        kind: "update",
        headSha: "3f786850e387550fdab836ed7e6dc881de23001b",
        fastForwarded: 2,
      },
    });
    await render({ git: remoteGit(port), isolation: "in-place" });
    const trigger = button("Server checkout");
    expect(trigger?.textContent).toContain("main");
    expect(trigger?.textContent).toContain("↓2");
    expect(trigger?.getAttribute("aria-label")).toBe("Server checkout: main, 2 behind origin/main");
    await click(trigger);
    const update = buttonByText("Update from origin");
    expect(update?.disabled).toBe(false);
    port.projectStatus.mockResolvedValue({
      ...cleanTracking,
      upstream: { ref: "origin/main", ahead: 0, behind: 0 },
    });
    await click(update);
    expect(port.update).toHaveBeenCalledTimes(1);
    expect(port.projectStatus).toHaveBeenCalledTimes(3);
    expect(document.body.textContent).toContain("Updated from origin.");
    expect(document.body.textContent).toContain("Up to date with origin/main");
    expect(button("Server checkout")?.textContent).not.toContain("↓");
  });

  it.each([
    [dirtyAtLimit, "git_dirty"],
    [detachedRebasing, "busy"],
  ] as const)("disables Update from origin with the exact reason", async (status, code) => {
    const port = fakePort(typical, status);
    await render({ git: remoteGit(port), isolation: "in-place" });
    await click(button("Server checkout"));
    expect(buttonByText("Update from origin")?.disabled).toBe(true);
    expect(document.body.textContent).toContain(remoteGitErrorMessage(code));
    expect(port.update).not.toHaveBeenCalled();
  });

  it("marks uncommitted changes on the server checkout", async () => {
    const port = fakePort(typical, dirtyAtLimit);
    await render({ git: remoteGit(port), isolation: "in-place" });
    expect(document.querySelector(".remote-git-dirty")).not.toBeNull();
    expect(button("Server checkout")?.getAttribute("aria-label")).toContain(
      "Uncommitted: 10000+ changed, 10000+ untracked",
    );
  });

  it("shows the server checkout status for a started in-place server thread", async () => {
    const port = fakePort();
    await render({
      git: remoteGit(port),
      isolation: "in-place",
      locked: true,
      started: STARTED_SERVER_CHECKOUT,
    });
    expect(button("Server checkout")?.textContent).toContain("↓2");
  });

  it("rereads the server checkout when the thread's turn settles", async () => {
    const port = fakePort();
    const props = {
      isolation: "in-place",
      locked: true,
      started: STARTED_SERVER_CHECKOUT,
    } as const;
    await render({ ...props, git: remoteGit(port, "turn-1") });
    expect(port.projectStatus).toHaveBeenCalledTimes(1);
    port.projectStatus.mockResolvedValue(dirtyAtLimit);
    await render({ ...props, git: remoteGit(port, "turn-2") });
    expect(port.projectStatus).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".remote-git-dirty")).not.toBeNull();
  });

  it("renders nothing when the runner does not offer Git sync", async () => {
    await render({ git: null, isolation: "worktree" });
    expect(host.innerHTML).toBe("");
    await render({
      git: null,
      isolation: "in-place",
      locked: true,
      started: STARTED_SERVER_CHECKOUT,
    });
    expect(host.innerHTML).toBe("");
  });
});
