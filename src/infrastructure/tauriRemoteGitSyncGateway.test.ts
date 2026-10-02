import { describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/remote-git-sync-wire.json";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import type { RemoteGitOperation } from "../domain/remoteGitSync";
import {
  REMOTE_GIT_COMMAND,
  REMOTE_GIT_POLL_INTERVAL_MS,
  REMOTE_GIT_POLL_LIMIT_MS,
  TauriRemoteGitSyncGateway,
  type InvokeRemoteGitCommand,
  type RemoteGitPollClock,
} from "./tauriRemoteGitSyncGateway";

type WireCase = Readonly<{ name: string; value: unknown }>;
type Contract = Readonly<{
  sections: Readonly<Record<string, Readonly<{ accepted: WireCase[]; rejected: WireCase[] }>>>;
}>;

const contract = wireContract as unknown as Contract;
const fixture = (section: string, name: string): unknown =>
  contract.sections[section]?.accepted.find((entry) => entry.name === name)?.value;
const connection = { serverId: "linux", runnerId: "linux-runner" } as const;
const project = { ...connection, projectId: "storefront" } as const;
const thread = { ...connection, taskId: "7389088c-29b8-4cec-9a15-e825e1fb2f66" } as const;
const KEY = "0b9d6f3e-6a51-4c1f-8d2e-7f1a2b3c4d5e";
const OPERATION = "5f0c1d2e-3a4b-4c5d-9e6f-7a8b9c0d1e2f";
const operation = (overrides: Partial<RemoteGitOperation> = {}): RemoteGitOperation => ({
  id: OPERATION,
  kind: "push",
  status: "running",
  error: null,
  result: null,
  ...overrides,
});
const pushed = fixture("gitOperation", "pushSucceeded") as RemoteGitOperation;

function fakeClock() {
  let now = 0;
  const clock: RemoteGitPollClock = {
    now: () => now,
    sleep: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
  return { clock, elapsed: () => now };
}

function gateway(invoke: InvokeRemoteGitCommand, clock = fakeClock().clock) {
  return new TauriRemoteGitSyncGateway(invoke, clock);
}

describe("tauri remote git sync gateway", () => {
  it("sends each operation as one closed request to the single command", async () => {
    const invoke = vi.fn<InvokeRemoteGitCommand>();
    const port = gateway(invoke);
    invoke.mockResolvedValueOnce(fixture("branchList", "typical"));
    await port.branches(project);
    invoke.mockResolvedValueOnce(fixture("checkoutStatus", "cleanTracking"));
    await port.projectStatus(project);
    invoke.mockResolvedValueOnce(operation({ kind: "fetch" }));
    await port.fetch(project, KEY);
    invoke.mockResolvedValueOnce(operation({ kind: "update" }));
    await port.update(project, KEY);
    invoke.mockResolvedValueOnce(fixture("threadGitStatus", "worktreeFromOrigin"));
    await port.threadStatus(thread);
    invoke.mockResolvedValueOnce(fixture("commitResult", "committed"));
    await port.commit(thread, "Fix checkout totals");
    invoke.mockResolvedValueOnce(operation());
    await port.push(thread, KEY, "base-branch");
    invoke.mockResolvedValueOnce(pushed);
    await port.pollOperation(connection, OPERATION);
    expect(invoke.mock.calls.map(([command, args]) => [command, args.request])).toEqual([
      [REMOTE_GIT_COMMAND, { ...project, operation: "projectBranches" }],
      [REMOTE_GIT_COMMAND, { ...project, operation: "projectStatus" }],
      [REMOTE_GIT_COMMAND, { ...project, operation: "projectFetch", idempotencyKey: KEY }],
      [REMOTE_GIT_COMMAND, { ...project, operation: "projectUpdate", idempotencyKey: KEY }],
      [REMOTE_GIT_COMMAND, { ...thread, operation: "threadStatus" }],
      [
        REMOTE_GIT_COMMAND,
        { ...thread, operation: "threadCommit", message: "Fix checkout totals" },
      ],
      [
        REMOTE_GIT_COMMAND,
        { ...thread, operation: "threadPush", idempotencyKey: KEY, target: "base-branch" },
      ],
      [REMOTE_GIT_COMMAND, { ...connection, operation: "operation", operationId: OPERATION }],
    ]);
  });

  it("refuses malformed requests before reaching Tauri", async () => {
    const invoke = vi.fn<InvokeRemoteGitCommand>();
    const port = gateway(invoke);
    await expect(port.commit(thread, "a\u0000b")).rejects.toBeInstanceOf(
      RemoteRunnerRequestRejectedError,
    );
    await expect(port.fetch(project, "not-a-uuid")).rejects.toBeInstanceOf(
      RemoteRunnerRequestRejectedError,
    );
    await expect(port.branches({ ...project, projectId: "../etc" })).rejects.toBeInstanceOf(
      RemoteRunnerRequestRejectedError,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns typed admission refusals and rejects mismatched jobs", async () => {
    const invoke = vi.fn<InvokeRemoteGitCommand>();
    const port = gateway(invoke);
    invoke.mockResolvedValueOnce({ error: "git_dirty" });
    expect(await port.update(project, KEY)).toEqual({ kind: "refused", error: "git_dirty" });
    invoke.mockResolvedValueOnce({ error: "git_nothing_to_commit" });
    expect(await port.commit(thread, "msg")).toEqual({
      kind: "refused",
      error: "git_nothing_to_commit",
    });
    invoke.mockResolvedValueOnce(operation({ kind: "fetch" }));
    await expect(port.push(thread, KEY, "thread-branch")).rejects.toThrow(
      "Invalid runner Git sync response.",
    );
    invoke.mockResolvedValueOnce({ error: "invalid_input" });
    await expect(port.fetch(project, KEY)).rejects.toThrow();
  });

  it.each(contract.sections.threadGitStatus?.rejected ?? [])(
    "rejects a thread status that is $name",
    async ({ value }) => {
      const port = gateway(vi.fn<InvokeRemoteGitCommand>().mockResolvedValue(value));
      await expect(port.threadStatus(thread)).rejects.toThrow();
    },
  );

  it("maps authoritative HTTP rejections to the rejected error type", async () => {
    const port = gateway(
      vi.fn<InvokeRemoteGitCommand>().mockRejectedValue("Runner request failed (HTTP 404)."),
    );
    await expect(port.threadStatus(thread)).rejects.toBeInstanceOf(
      RemoteRunnerRequestRejectedError,
    );
  });
});

describe("remote git operation polling", () => {
  it("polls once per interval until the job settles", async () => {
    const { clock, elapsed } = fakeClock();
    const invoke = vi
      .fn<InvokeRemoteGitCommand>()
      .mockResolvedValueOnce(operation())
      .mockResolvedValueOnce(pushed);
    const outcome = await gateway(invoke, clock).awaitOperation(connection, operation());
    expect(outcome).toEqual({ kind: "succeeded", result: pushed.result });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(elapsed()).toBe(2 * REMOTE_GIT_POLL_INTERVAL_MS);
  });

  it("does not poll an already settled job", async () => {
    const invoke = vi.fn<InvokeRemoteGitCommand>();
    const failed = operation({ status: "failed", error: "git_auth_failed" });
    expect(await gateway(invoke).awaitOperation(connection, failed)).toEqual({
      kind: "failed",
      error: "git_auth_failed",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports a forgotten job as unknown", async () => {
    const invoke = vi.fn<InvokeRemoteGitCommand>().mockResolvedValue({ outcome: "unknown" });
    expect(await gateway(invoke).awaitOperation(connection, operation())).toEqual({
      kind: "unknown",
    });
  });

  it("stops at the polling deadline", async () => {
    const { clock, elapsed } = fakeClock();
    const invoke = vi.fn<InvokeRemoteGitCommand>().mockResolvedValue(operation());
    expect(await gateway(invoke, clock).awaitOperation(connection, operation())).toEqual({
      kind: "timedOut",
    });
    expect(elapsed()).toBe(REMOTE_GIT_POLL_LIMIT_MS);
    expect(invoke).toHaveBeenCalledTimes(REMOTE_GIT_POLL_LIMIT_MS / REMOTE_GIT_POLL_INTERVAL_MS);
  });

  it("stops without another poll once aborted", async () => {
    const controller = new AbortController();
    const invoke = vi.fn<InvokeRemoteGitCommand>().mockImplementation(async () => {
      controller.abort();
      return operation();
    });
    expect(
      await gateway(invoke).awaitOperation(connection, operation(), controller.signal),
    ).toEqual({ kind: "aborted" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("retries transient poll failures within a bound and fails closed on invalid data", async () => {
    const transient = vi
      .fn<InvokeRemoteGitCommand>()
      .mockRejectedValueOnce("Runner request timed out. Its outcome may be unknown.")
      .mockResolvedValueOnce(pushed);
    expect(await gateway(transient).awaitOperation(connection, operation())).toEqual({
      kind: "succeeded",
      result: pushed.result,
    });
    const down = vi.fn<InvokeRemoteGitCommand>().mockRejectedValue("Server is not connected");
    await expect(gateway(down).awaitOperation(connection, operation())).rejects.toThrow(
      "Server is not connected",
    );
    expect(down).toHaveBeenCalledTimes(3);
    const foreign = vi
      .fn<InvokeRemoteGitCommand>()
      .mockResolvedValue({ ...pushed, id: "6a1d2e3f-4b5c-4d6e-8f70-8b9c0d1e2f3a" });
    await expect(gateway(foreign).awaitOperation(connection, operation())).rejects.toThrow(
      "Invalid runner Git sync response.",
    );
    expect(foreign).toHaveBeenCalledTimes(1);
    const otherKind = vi
      .fn<InvokeRemoteGitCommand>()
      .mockResolvedValue(fixture("gitOperation", "fetchSucceeded"));
    await expect(gateway(otherKind).awaitOperation(connection, operation())).rejects.toThrow(
      "Invalid runner Git sync response.",
    );
  });
});
