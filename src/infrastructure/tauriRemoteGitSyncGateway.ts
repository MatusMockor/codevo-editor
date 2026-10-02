import { invoke } from "@tauri-apps/api/core";
import {
  REMOTE_GIT_INVALID_RESPONSE,
  isRemoteGitOperationOf,
  parseRemoteGitAdmission,
  parseRemoteGitPoll,
  settledRemoteGitOperation,
  type RemoteGitAdmission,
  type RemoteGitBranchList,
  type RemoteGitCheckoutStatus,
  type RemoteGitCommitResult,
  type RemoteGitConnection,
  type RemoteGitOperation,
  type RemoteGitOperationOutcome,
  type RemoteGitPoll,
  type RemoteGitProjectKey,
  type RemoteGitPushTarget,
  type RemoteGitSyncPort,
  type RemoteGitThreadKey,
  type RemoteThreadGitStatus,
} from "../domain/remoteGitSync";
import {
  isRemoteGitBranchList,
  isRemoteGitCheckoutStatus,
  isRemoteGitCommitResult,
  isRemoteGitRequest,
  isRemoteThreadGitStatus,
  type RemoteGitRequest,
} from "../domain/remoteGitSyncWire";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";

export const REMOTE_GIT_COMMAND = "remote_runner_git";
export const REMOTE_GIT_POLL_INTERVAL_MS = 1_000;
export const REMOTE_GIT_POLL_LIMIT_MS = 150_000;
export const REMOTE_GIT_POLL_ERROR_LIMIT = 3;

const INVALID_RESPONSE_PREFIX = "Invalid runner Git sync response";
const REJECTED = /^Runner request failed \(HTTP (400|404|409|413|422)\)\.$/u;

export type InvokeRemoteGitCommand = (
  command: typeof REMOTE_GIT_COMMAND,
  args: Readonly<{ request: RemoteGitRequest }>,
) => Promise<unknown>;

export interface RemoteGitPollClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

const systemClock: RemoteGitPollClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done, { once: true });
    }),
};

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

function retryable(error: unknown): boolean {
  return (
    !(error instanceof RemoteRunnerRequestRejectedError) &&
    !errorMessage(error).startsWith(INVALID_RESPONSE_PREFIX)
  );
}

export class TauriRemoteGitSyncGateway implements RemoteGitSyncPort {
  constructor(
    private readonly invokeCommand: InvokeRemoteGitCommand = (command, args) =>
      invoke<unknown>(command, args),
    private readonly clock: RemoteGitPollClock = systemClock,
  ) {}

  private async call(request: RemoteGitRequest): Promise<unknown> {
    if (!isRemoteGitRequest(request)) {
      throw new RemoteRunnerRequestRejectedError("Invalid remote Git request.");
    }
    try {
      return await this.invokeCommand(REMOTE_GIT_COMMAND, { request });
    } catch (error) {
      const message = errorMessage(error);
      if (REJECTED.test(message)) throw new RemoteRunnerRequestRejectedError(message);
      throw error instanceof Error ? error : new Error(message || "Remote Git request failed.");
    }
  }

  private async read<T>(request: RemoteGitRequest, check: (value: unknown) => boolean) {
    const value = await this.call(request);
    if (!check(value)) throw new Error(REMOTE_GIT_INVALID_RESPONSE);
    return value as T;
  }

  branches(project: RemoteGitProjectKey): Promise<RemoteGitBranchList> {
    return this.read({ ...project, operation: "projectBranches" }, isRemoteGitBranchList);
  }

  projectStatus(project: RemoteGitProjectKey): Promise<RemoteGitCheckoutStatus> {
    return this.read({ ...project, operation: "projectStatus" }, isRemoteGitCheckoutStatus);
  }

  async fetch(
    project: RemoteGitProjectKey,
    idempotencyKey: string,
  ): Promise<RemoteGitAdmission<RemoteGitOperation>> {
    const value = await this.call({ ...project, operation: "projectFetch", idempotencyKey });
    return parseRemoteGitAdmission(value, isRemoteGitOperationOf("fetch"));
  }

  async update(
    project: RemoteGitProjectKey,
    idempotencyKey: string,
  ): Promise<RemoteGitAdmission<RemoteGitOperation>> {
    const value = await this.call({ ...project, operation: "projectUpdate", idempotencyKey });
    return parseRemoteGitAdmission(value, isRemoteGitOperationOf("update"));
  }

  threadStatus(thread: RemoteGitThreadKey): Promise<RemoteThreadGitStatus> {
    return this.read({ ...thread, operation: "threadStatus" }, isRemoteThreadGitStatus);
  }

  async commit(
    thread: RemoteGitThreadKey,
    message: string,
  ): Promise<RemoteGitAdmission<RemoteGitCommitResult>> {
    const value = await this.call({ ...thread, operation: "threadCommit", message });
    return parseRemoteGitAdmission(value, isRemoteGitCommitResult);
  }

  async push(
    thread: RemoteGitThreadKey,
    idempotencyKey: string,
    target: RemoteGitPushTarget,
  ): Promise<RemoteGitAdmission<RemoteGitOperation>> {
    const value = await this.call({ ...thread, operation: "threadPush", idempotencyKey, target });
    return parseRemoteGitAdmission(value, isRemoteGitOperationOf("push"));
  }

  async pollOperation(
    connection: RemoteGitConnection,
    operationId: string,
  ): Promise<RemoteGitPoll> {
    const value = await this.call({
      serverId: connection.serverId,
      runnerId: connection.runnerId,
      operation: "operation",
      operationId,
    });
    return parseRemoteGitPoll(value, operationId);
  }

  async awaitOperation(
    connection: RemoteGitConnection,
    operation: RemoteGitOperation,
    signal?: AbortSignal,
  ): Promise<RemoteGitOperationOutcome> {
    const started = this.clock.now();
    let current = operation;
    let failures = 0;
    for (;;) {
      const settled = settledRemoteGitOperation(current);
      if (settled !== null) return settled;
      if (signal?.aborted) return { kind: "aborted" };
      if (this.clock.now() - started >= REMOTE_GIT_POLL_LIMIT_MS) return { kind: "timedOut" };
      await this.clock.sleep(REMOTE_GIT_POLL_INTERVAL_MS, signal);
      if (signal?.aborted) return { kind: "aborted" };
      let polled: RemoteGitPoll;
      try {
        polled = await this.pollOperation(connection, operation.id);
      } catch (error) {
        failures += 1;
        if (failures >= REMOTE_GIT_POLL_ERROR_LIMIT || !retryable(error)) throw error;
        continue;
      }
      failures = 0;
      if (polled.kind === "unknown") return { kind: "unknown" };
      if (polled.operation.kind !== operation.kind) throw new Error(REMOTE_GIT_INVALID_RESPONSE);
      current = polled.operation;
    }
  }
}
