// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/remote-git-sync-wire.json";
import type {
  RemoteGitCommitResult,
  RemoteGitOperation,
  RemoteGitSyncPort,
  RemoteThreadGitStatus,
} from "../domain/remoteGitSync";
import { remoteGitErrorMessage } from "../domain/remoteGitSync";
import {
  REMOTE_SHIP_PUSH_UNCONFIRMED,
  REMOTE_SHIP_STOP_AGENT_MESSAGE,
  type RemoteShipTarget,
} from "./remoteThreadShip";
import { useRemoteThreadShip, type RemoteThreadShipSurface } from "./useRemoteThreadShip";

type WireCase = Readonly<{ name: string; value: unknown }>;
type Contract = Readonly<{
  sections: Readonly<Record<string, Readonly<{ accepted: WireCase[] }>>>;
}>;
const contract = wireContract as unknown as Contract;
const fixture = <T,>(section: string, name: string): T =>
  contract.sections[section]?.accepted.find((entry) => entry.name === name)?.value as T;

const THREAD = "remote-thread:linux:linux-runner:7389088c-29b8-4cec-9a15-e825e1fb2f66";
const CONVERSATION = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
const OPERATION = "5f0c1d2e-3a4b-4c5d-9e6f-7a8b9c0d1e2f";
const status = fixture<RemoteThreadGitStatus>("threadGitStatus", "worktreeFromOrigin");
const committed = fixture<RemoteGitCommitResult>("commitResult", "committed");
const runningPush: RemoteGitOperation = {
  id: OPERATION,
  kind: "push",
  status: "running",
  error: null,
  result: null,
};
const pushedPublished: RemoteThreadGitStatus = {
  ...status,
  published: { ref: "origin/codevo/7389088c", ahead: 0, behind: 0 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakePort() {
  return {
    branches: vi.fn(),
    projectStatus: vi.fn(),
    fetch: vi.fn(),
    update: vi.fn(),
    threadStatus: vi.fn().mockResolvedValue(status),
    commit: vi.fn().mockResolvedValue({ kind: "accepted", value: committed }),
    push: vi.fn().mockResolvedValue({ kind: "accepted", value: runningPush }),
    pollOperation: vi.fn(),
    awaitOperation: vi.fn().mockResolvedValue({
      kind: "succeeded",
      result: {
        kind: "push",
        remoteRef: "refs/heads/codevo/7389088c",
        pushedSha: status.headSha,
        created: true,
      },
    }),
  } satisfies RemoteGitSyncPort;
}

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

async function render(port = fakePort()) {
  const root = createRoot(document.createElement("div"));
  let target: RemoteShipTarget | null = {
    threadId: THREAD,
    serverId: "linux",
    runnerId: "linux-runner",
    conversationId: CONVERSATION,
    repositoryKey: "github.com/acme/shop",
    running: false,
  };
  const setNotice = vi.fn();
  const reportError = vi.fn();
  const opener = { openExternal: vi.fn().mockResolvedValue(undefined) };
  let surface!: RemoteThreadShipSurface;
  function Harness() {
    surface = useRemoteThreadShip({
      port,
      resolve: (threadId) => (threadId === target?.threadId ? target : null),
      externalUrlOpener: opener,
      setNotice,
      reportError,
    });
    return null;
  }
  await act(async () => {
    root.render(createElement(Harness));
  });
  disposers.push(() => act(() => root.unmount()));
  return {
    port,
    setNotice,
    reportError,
    opener,
    current: () => surface,
    state: () => surface.states.get(THREAD),
    retarget: (next: Partial<RemoteShipTarget> | null) => {
      target = next === null || target === null ? null : { ...target, ...next };
    },
  };
}

describe("remote thread ship", () => {
  it("refreshes the server status into the shared ship state", async () => {
    const h = await render();
    await act(() => h.current().refreshShipStatus(THREAD));
    expect(h.port.threadStatus).toHaveBeenCalledWith({
      serverId: "linux",
      runnerId: "linux-runner",
      taskId: CONVERSATION,
    });
    const state = h.state();
    expect(state?.kind).toBe("idle");
    expect(state?.kind === "idle" && state.status?.worktree.branch).toBe("codevo/7389088c");
    expect(state?.kind === "idle" && state.loadingStatus).toBe(false);
    expect(h.current().gitStatuses.get(THREAD)).toEqual(status);
  });

  it("commits all changes and records the server commit", async () => {
    const h = await render();
    let result: unknown;
    await act(async () => {
      result = await h.current().commit(THREAD, "  Fix checkout totals \n");
    });
    expect(result).toEqual({ kind: "succeeded" });
    expect(h.port.commit).toHaveBeenCalledWith(
      { serverId: "linux", runnerId: "linux-runner", taskId: CONVERSATION },
      "Fix checkout totals",
    );
    const state = h.state();
    expect(state?.kind === "committed" && state.commitSha).toBe(committed.commitSha);
  });

  it("maps a commit refusal to the ship failure reason with runner copy", async () => {
    const port = fakePort();
    port.commit.mockResolvedValue({ kind: "refused", error: "git_nothing_to_commit" });
    const h = await render(port);
    let result: unknown;
    await act(async () => {
      result = await h.current().commit(THREAD, "msg");
    });
    expect(result).toEqual({
      kind: "failed",
      failure: { step: "commit", reason: "nothingToCommit", message: "Nothing to commit." },
    });
    expect(h.state()?.kind).toBe("failed");
  });

  it("does not ship while the agent is running or with an invalid message", async () => {
    const h = await render();
    h.retarget({ running: true });
    expect(await h.current().commit(THREAD, "msg")).toEqual({
      kind: "notRun",
      message: REMOTE_SHIP_STOP_AGENT_MESSAGE,
    });
    h.retarget({ running: false });
    expect((await h.current().commit(THREAD, "a\u0007b")).kind).toBe("notRun");
    expect(h.port.commit).not.toHaveBeenCalled();
  });

  it("pushes the thread branch, waits for the job and offers the compare page", async () => {
    const port = fakePort();
    port.threadStatus.mockResolvedValue(pushedPublished);
    const h = await render(port);
    let result: unknown;
    await act(async () => {
      result = await h.current().push(THREAD);
    });
    expect(result).toEqual({ kind: "succeeded" });
    const [, key, target] = port.push.mock.calls[0] as [unknown, string, string];
    expect(key).toMatch(/^[0-9a-f-]{36}$/u);
    expect(target).toBe("thread-branch");
    const state = h.state();
    expect(state?.kind).toBe("pushed");
    expect(state?.kind === "pushed" && state.receipt).toEqual({
      remote: "origin",
      branch: "codevo/7389088c",
      compareUrl: "https://github.com/acme/shop/compare/main...codevo/7389088c?expand=1",
    });
    await act(() => h.current().openCompareUrl(THREAD));
    expect(h.opener.openExternal).toHaveBeenCalledWith(
      "https://github.com/acme/shop/compare/main...codevo/7389088c?expand=1",
    );
  });

  it.each([
    ["git_rejected_non_fast_forward", "rejected"],
    ["git_auth_failed", "authRequired"],
    ["git_no_remote", "noRemote"],
    ["busy", "gitError"],
  ] as const)("maps a push refusal %s to %s", async (code, reason) => {
    const port = fakePort();
    port.push.mockResolvedValue({ kind: "refused", error: code });
    const h = await render(port);
    let result: unknown;
    await act(async () => {
      result = await h.current().push(THREAD);
    });
    expect(result).toEqual({
      kind: "failed",
      failure: { step: "push", reason, message: remoteGitErrorMessage(code) },
    });
    expect(port.awaitOperation).not.toHaveBeenCalled();
  });

  it("reports a failed push job and refreshes the status", async () => {
    const port = fakePort();
    port.awaitOperation.mockResolvedValue({ kind: "failed", error: "git_rejected" });
    const h = await render(port);
    await act(async () => {
      await h.current().push(THREAD, "base-branch");
    });
    const state = h.state();
    expect(state?.kind === "failed" && state.failure).toEqual({
      step: "push",
      reason: "rejected",
      message: remoteGitErrorMessage("git_rejected"),
    });
    expect(state?.kind === "failed" && state.status?.worktree.head).toBe(status.headSha);
  });

  it.each(["unknown", "timedOut"] as const)("never claims a push whose job is %s", async (kind) => {
    const port = fakePort();
    port.awaitOperation.mockResolvedValue({ kind });
    const h = await render(port);
    let result: unknown;
    await act(async () => {
      result = await h.current().push(THREAD);
    });
    expect(result).toEqual({
      kind: "failed",
      failure: { step: "push", reason: "gitError", message: REMOTE_SHIP_PUSH_UNCONFIRMED },
    });
    expect(port.threadStatus).toHaveBeenCalled();
  });

  it("fails closed when the thread changes owner during a commit", async () => {
    const port = fakePort();
    const pending = deferred<{ kind: "refused"; error: "busy" }>();
    port.commit.mockReturnValue(pending.promise);
    const h = await render(port);
    let result: Promise<unknown> = Promise.resolve();
    await act(async () => {
      result = h.current().commit(THREAD, "msg");
    });
    h.retarget({ runnerId: "replacement-runner" });
    await act(async () => {
      pending.resolve({ kind: "refused", error: "busy" });
      await result;
    });
    expect(await result).toEqual({
      kind: "failed",
      failure: { step: "commit", reason: "authorityLost" },
    });
  });

  it("drops a stale status after the thread was cleared and reopened", async () => {
    const port = fakePort();
    const stale = deferred<RemoteThreadGitStatus>();
    port.threadStatus.mockReturnValueOnce(stale.promise);
    const h = await render(port);
    let refresh: Promise<void> = Promise.resolve();
    await act(async () => {
      refresh = h.current().refreshShipStatus(THREAD);
    });
    await act(async () => {
      h.current().clear(THREAD);
    });
    await act(async () => {
      stale.resolve({ ...status, headSha: "0".repeat(40) });
      await refresh;
    });
    expect(h.state()).toBeUndefined();
    expect(h.current().gitStatuses.has(THREAD)).toBe(false);
  });

  it("aborts push polling when the thread is cleared", async () => {
    const port = fakePort();
    let signal: AbortSignal | undefined;
    const settled = deferred<{ kind: "aborted" }>();
    port.awaitOperation.mockImplementation(async (_connection, _operation, abort) => {
      signal = abort;
      return settled.promise;
    });
    const h = await render(port);
    let push: Promise<unknown> = Promise.resolve();
    await act(async () => {
      push = h.current().push(THREAD);
    });
    await act(async () => {
      h.current().clear(THREAD);
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      settled.resolve({ kind: "aborted" });
      await push;
    });
    expect(await push).toEqual({
      kind: "failed",
      failure: { step: "push", reason: "authorityLost" },
    });
    expect(h.state()).toBeUndefined();
  });

  it.each([
    [{ kind: "failed", error: "git_rejected_non_fast_forward" }, "authorityLost"],
    [{ kind: "unknown" }, "authorityLost"],
    [
      {
        kind: "succeeded",
        result: {
          kind: "push",
          remoteRef: "refs/heads/codevo/7389088c",
          pushedSha: status.headSha,
          created: true,
        },
      },
      "settled",
    ],
  ] as const)(
    "reports %j as %s when the owner changes during polling",
    async (outcome, expected) => {
      const port = fakePort();
      const settled = deferred<typeof outcome>();
      port.awaitOperation.mockReturnValue(settled.promise);
      const h = await render(port);
      let push: Promise<unknown> = Promise.resolve();
      await act(async () => {
        push = h.current().push(THREAD);
      });
      h.retarget({ conversationId: "00000000-0000-4000-8000-000000000001" });
      await act(async () => {
        settled.resolve(outcome);
        await push;
      });
      expect(await push).toEqual(
        expected === "settled"
          ? { kind: "succeeded" }
          : { kind: "failed", failure: { step: "push", reason: "authorityLost" } },
      );
      expect(port.threadStatus).not.toHaveBeenCalled();
    },
  );

  it("drops a refresh that started before a commit finished", async () => {
    const port = fakePort();
    const stale = deferred<RemoteThreadGitStatus>();
    port.threadStatus.mockReturnValueOnce(stale.promise);
    const h = await render(port);
    let refresh: Promise<void> = Promise.resolve();
    await act(async () => {
      refresh = h.current().refreshShipStatus(THREAD);
    });
    await act(async () => {
      await h.current().commit(THREAD, "msg");
    });
    await act(async () => {
      stale.resolve({ ...status, headSha: "0".repeat(40) });
      await refresh;
    });
    const state = h.state();
    expect(state?.kind === "committed" && state.status?.worktree.head).toBe(
      committed.status.headSha,
    );
    expect(h.current().gitStatuses.get(THREAD)).toEqual(committed.status);
  });

  it("refreshes the status after an uncertain commit transport failure", async () => {
    const port = fakePort();
    port.commit.mockRejectedValue(
      new Error("Runner request timed out. Its outcome may be unknown."),
    );
    const h = await render(port);
    await act(async () => {
      await h.current().commit(THREAD, "msg");
    });
    const state = h.state();
    expect(state?.kind === "failed" && state.failure).toEqual({
      step: "commit",
      reason: "gitError",
      message: "Runner request timed out. Its outcome may be unknown.",
    });
    expect(port.threadStatus).toHaveBeenCalledOnce();
    expect(state?.kind === "failed" && state.status?.worktree.head).toBe(status.headSha);
  });

  it("drops a pending status after the thread moves A -> B -> A", async () => {
    const port = fakePort();
    const stale = deferred<RemoteThreadGitStatus>();
    port.threadStatus.mockReturnValueOnce(stale.promise);
    const h = await render(port);
    let refresh: Promise<void> = Promise.resolve();
    await act(async () => {
      refresh = h.current().refreshShipStatus(THREAD);
    });
    h.retarget({ runnerId: "other-runner" });
    await act(async () => {
      await h.current().refreshShipStatus(THREAD);
    });
    h.retarget({ runnerId: "linux-runner" });
    await act(async () => {
      stale.resolve({ ...status, headSha: "0".repeat(40) });
      await refresh;
    });
    expect(h.current().gitStatuses.get(THREAD)?.headSha).not.toBe("0".repeat(40));
  });
});
