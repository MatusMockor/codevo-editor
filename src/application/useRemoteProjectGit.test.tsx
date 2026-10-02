// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/remote-git-sync-wire.json";
import {
  remoteGitErrorMessage,
  type RemoteGitBranchList,
  type RemoteGitCheckoutStatus,
  type RemoteGitOperation,
  type RemoteGitProjectKey,
  type RemoteGitSyncPort,
} from "../domain/remoteGitSync";
import {
  REMOTE_PROJECT_GIT_UNCONFIRMED,
  useRemoteProjectGit,
  type RemoteProjectGit,
} from "./useRemoteProjectGit";

type WireCase = Readonly<{ name: string; value: unknown }>;
type Contract = Readonly<{
  sections: Readonly<Record<string, Readonly<{ accepted: WireCase[] }>>>;
}>;
const contract = wireContract as unknown as Contract;
const fixture = <T,>(section: string, name: string): T =>
  contract.sections[section]?.accepted.find((entry) => entry.name === name)?.value as T;

const A: RemoteGitProjectKey = { serverId: "linux", runnerId: "linux-runner", projectId: "a" };
const B: RemoteGitProjectKey = { serverId: "linux", runnerId: "linux-runner", projectId: "b" };
const branches = fixture<RemoteGitBranchList>("branchList", "typical");
const checkout = fixture<RemoteGitCheckoutStatus>("checkoutStatus", "cleanTracking");
const running = (kind: "fetch" | "update"): RemoteGitOperation => ({
  id: "5f0c1d2e-3a4b-4c5d-9e6f-7a8b9c0d1e2f",
  kind,
  status: "running",
  error: null,
  result: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakePort() {
  return {
    branches: vi.fn().mockResolvedValue(branches),
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

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

async function render(port = fakePort(), initial: RemoteGitProjectKey | null = A) {
  const root = createRoot(document.createElement("div"));
  let surface!: RemoteProjectGit;
  let activePort: RemoteGitSyncPort = port;
  function Harness({ project }: { project: RemoteGitProjectKey | null }) {
    surface = useRemoteProjectGit({ port: activePort, project });
    return null;
  }
  let shown = initial;
  const show = async (project: RemoteGitProjectKey | null) => {
    shown = project;
    await act(async () => {
      root.render(createElement(Harness, { project }));
    });
  };
  const replacePort = async (next: RemoteGitSyncPort) => {
    activePort = next;
    await show(shown);
  };
  await show(initial);
  disposers.push(() => act(() => root.unmount()));
  return { port, show, replacePort, current: () => surface };
}

describe("remote project git", () => {
  it("loads branches and the checkout status for the exact project", async () => {
    const h = await render();
    await act(() => h.current().refresh());
    expect(h.port.branches).toHaveBeenCalledWith(A);
    expect(h.port.projectStatus).toHaveBeenCalledWith(A);
    expect(h.current().branches).toEqual({ kind: "ready", value: branches });
    expect(h.current().checkout).toEqual({ kind: "ready", value: checkout });
  });

  it("drops a stale result after switching A -> B -> A", async () => {
    const port = fakePort();
    const stale = deferred<RemoteGitBranchList>();
    port.branches.mockReturnValueOnce(stale.promise);
    const h = await render(port);
    let refresh: Promise<void> = Promise.resolve();
    await act(async () => {
      refresh = h.current().refresh();
    });
    await h.show(B);
    await h.show(A);
    await act(async () => {
      stale.resolve({ ...branches, defaultBranch: "stale" });
      await refresh;
    });
    expect(h.current().branches).toEqual({ kind: "idle" });
    expect(h.current().checkout).toEqual({ kind: "idle" });
  });

  it("fetches, waits for the job and refreshes branches and status", async () => {
    const h = await render();
    await act(() => h.current().fetch());
    const [, key] = h.port.fetch.mock.calls[0] as [RemoteGitProjectKey, string];
    expect(key).toMatch(/^[0-9a-f-]{36}$/u);
    expect(h.current().network).toEqual({ kind: "succeeded", action: "fetch" });
    expect(h.port.branches).toHaveBeenCalledOnce();
    expect(h.port.projectStatus).toHaveBeenCalledOnce();
  });

  it("reports an update refusal with the closed copy and does not poll", async () => {
    const port = fakePort();
    port.update.mockResolvedValue({ kind: "refused", error: "git_dirty" });
    const h = await render(port);
    await act(() => h.current().update());
    expect(h.current().network).toEqual({
      kind: "failed",
      action: "update",
      error: "git_dirty",
      message: remoteGitErrorMessage("git_dirty"),
    });
    expect(port.awaitOperation).not.toHaveBeenCalled();
  });

  it("treats a forgotten update job as unconfirmed and refreshes the status", async () => {
    const port = fakePort();
    port.awaitOperation.mockResolvedValue({ kind: "unknown" });
    const h = await render(port);
    await act(() => h.current().update());
    expect(h.current().network).toEqual({
      kind: "failed",
      action: "update",
      error: null,
      message: REMOTE_PROJECT_GIT_UNCONFIRMED,
    });
    expect(port.projectStatus).toHaveBeenCalledOnce();
    expect(port.branches).not.toHaveBeenCalled();
  });

  it("aborts polling and ignores the job when the project changes", async () => {
    const port = fakePort();
    let signal: AbortSignal | undefined;
    const settled = deferred<{ kind: "aborted" }>();
    port.awaitOperation.mockImplementation(async (_connection, _operation, abort) => {
      signal = abort;
      return settled.promise;
    });
    const h = await render(port);
    let fetch: Promise<void> = Promise.resolve();
    await act(async () => {
      fetch = h.current().fetch();
    });
    expect(h.current().network).toEqual({ kind: "running", action: "fetch" });
    await h.show(B);
    expect(signal?.aborted).toBe(true);
    expect(h.current().network).toEqual({ kind: "idle" });
    await act(async () => {
      settled.resolve({ kind: "aborted" });
      await fetch;
    });
    expect(h.current().network).toEqual({ kind: "idle" });
    expect(port.branches).not.toHaveBeenCalled();
  });

  it("keeps the newest branch list when an older load resolves last", async () => {
    const port = fakePort();
    const older = deferred<RemoteGitBranchList>();
    port.branches
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce({ ...branches, defaultBranch: "fresh" });
    const h = await render(port);
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = h.current().refresh();
    });
    await act(() => h.current().fetch());
    await act(async () => {
      older.resolve({ ...branches, defaultBranch: "stale" });
      await first;
    });
    const loaded = h.current().branches;
    expect(loaded.kind === "ready" && loaded.value.defaultBranch).toBe("fresh");
  });

  it("resets a running operation when the port is replaced for the same project", async () => {
    const port = fakePort();
    const settled = deferred<{ kind: "aborted" }>();
    port.awaitOperation.mockReturnValue(settled.promise);
    const h = await render(port);
    let fetch: Promise<void> = Promise.resolve();
    await act(async () => {
      fetch = h.current().fetch();
    });
    await h.replacePort(fakePort());
    expect(h.current().network).toEqual({ kind: "idle" });
    await act(async () => {
      settled.resolve({ kind: "aborted" });
      await fetch;
    });
    expect(h.current().network).toEqual({ kind: "idle" });
    expect(h.current().branches).toEqual({ kind: "idle" });
  });

  it("runs one network operation at a time and nothing without a project", async () => {
    const port = fakePort();
    const pending = deferred<{ kind: "accepted"; value: RemoteGitOperation }>();
    port.fetch.mockReturnValueOnce(pending.promise);
    const h = await render(port);
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = h.current().fetch();
    });
    await act(() => h.current().update());
    expect(port.update).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ kind: "accepted", value: running("fetch") });
      await first;
    });
    await h.show(null);
    await act(() => h.current().refresh());
    expect(port.branches).toHaveBeenCalledOnce();
  });
});
