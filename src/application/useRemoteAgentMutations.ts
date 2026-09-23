import { collectRemoteInstructions } from "./collectRemoteInstructions";
import type { RemoteRunnerInstructionSnapshot } from "../domain/remoteRunnerInstructions";
import { useEffect, useRef, useState } from "react";
import type {
  AgentFollowUpRequest,
  AgentThreadStartRequest,
  AgentTurnAttachmentRequest,
} from "./agentThreadPorts";
import type {
  RemoteRunnerGateway,
  RemoteRunnerPart,
  RemoteRunnerProvider,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import {
  isRemoteRunnerRequestRejectedError,
  remoteRunnerErrorMessage,
} from "../domain/remoteRunnerErrors";
import { agentLaunchWithoutBrowser, type AgentLaunchOptions } from "../domain/agentLaunch";

export interface RemoteAgentMutationTarget {
  readonly serverId: string;
  readonly runnerId: string;
  readonly projectId: string;
  readonly conversationId?: string;
  readonly latestTaskId?: string;
}
interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly owner: object;
  valid(owner: object): boolean;
  publish(serverId: string, task: RemoteRunnerTask): void;
  report(message: string): void;
  resolveAttachments?(
    request: AgentTurnAttachmentRequest,
    serverId: string,
  ): Promise<readonly RemoteRunnerPart[]>;
}
type Request = AgentThreadStartRequest | AgentFollowUpRequest;
interface Execution {
  stopAfter: boolean;
}
const EMPTY_KEYS: ReadonlySet<string> = new Set();
export const MAX_REMOTE_IN_FLIGHT_MUTATIONS = 32;
export const REMOTE_CONVERSATION_BUSY_NOTICE =
  "This remote conversation is already sending a message. Wait for it to arrive.";
export const REMOTE_STOP_UNAPPLIED_NOTICE =
  "Stop could not be applied because the message was not confirmed. Refresh the conversation and stop it if it is running.";
export const REMOTE_MUTATIONS_FULL_NOTICE =
  "Too many remote actions are in progress. Wait for one to finish.";
function sameLaunch(task: RemoteRunnerTask, expected: AgentLaunchOptions): boolean {
  const actual = task.launch;
  if (!actual) return false;
  if (
    actual.provider !== expected.provider ||
    actual.model !== expected.model ||
    actual.mode !== expected.mode
  )
    return false;
  return (
    actual.provider !== "claudeCode" ||
    expected.provider !== "claudeCode" ||
    (actual.effort === expected.effort &&
      (actual.context ?? "1m") === (expected.context ?? "1m") &&
      (actual.fastMode ?? false) === (expected.fastMode ?? false) &&
      (actual.thinkingMode ?? false) === (expected.thinkingMode ?? false))
  );
}
type Pending = {
  readonly signature: string;
  readonly idempotencyKey: string;
  readonly parts: readonly RemoteRunnerPart[];
  readonly instructions?: RemoteRunnerInstructionSnapshot;
  readonly parentTaskId?: string;
  readonly isolation: "worktree" | "in-place";
  readonly sendIsolation: boolean;
  draftId?: string;
};
function key(target: RemoteAgentMutationTarget): string {
  return JSON.stringify([
    target.serverId,
    target.runnerId,
    target.projectId,
    target.conversationId ?? null,
  ]);
}
function sameParts(left: readonly RemoteRunnerPart[], right: readonly RemoteRunnerPart[]): boolean {
  return (
    left.length === right.length &&
    left.every((part, index) => {
      const other = right[index];
      return part.type === "text"
        ? other?.type === "text" && part.text === other.text
        : other?.type === "attachment" && part.attachmentId === other.attachmentId;
    })
  );
}

/** Owns exact commands across uncertain delivery; display selection never grants execution authority. */
export function useRemoteAgentMutations(options: Options) {
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [stopping, setStopping] = useState(false);
  const executions = useRef(new Map<string, Execution>());
  const executionKeys = useRef(new Map<string, string>());
  const stops = useRef(new Map<string, Promise<void>>());
  const mounted = useRef(true);
  const latest = useRef(options);
  latest.current = options;
  const pending = useRef(new Map<string, Pending>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const valid = () =>
    mounted.current &&
    latest.current.owner === options.owner &&
    latest.current.gateway === options.gateway &&
    options.valid(options.owner);

  const publishActivity = () => {
    if (!mounted.current) return;
    setBusyKeys(
      executionKeys.current.size === 0 ? EMPTY_KEYS : new Set(executionKeys.current.values()),
    );
    setStopping(stops.current.size > 0);
  };

  async function execute(
    request: Request,
    target: RemoteAgentMutationTarget,
    continuation: boolean,
    dispatchKey: string,
  ): Promise<RemoteRunnerTask | null> {
    const gateway = options.gateway;
    if (!gateway || !valid()) return null;
    const targetKey = key(target);
    if (executions.current.has(targetKey)) {
      options.report(REMOTE_CONVERSATION_BUSY_NOTICE);
      return null;
    }
    if (executions.current.size >= MAX_REMOTE_IN_FLIGHT_MUTATIONS) {
      options.report(REMOTE_MUTATIONS_FULL_NOTICE);
      return null;
    }
    const execution: Execution = { stopAfter: false };
    executions.current.set(targetKey, execution);
    executionKeys.current.set(targetKey, dispatchKey);
    publishActivity();
    let task: RemoteRunnerTask | null;
    try {
      task = await executeOwned(gateway, request, target, continuation, targetKey);
    } finally {
      executions.current.delete(targetKey);
      executionKeys.current.delete(targetKey);
      publishActivity();
    }
    if (!execution.stopAfter) return task;
    if (task === null) {
      if (valid()) options.report(REMOTE_STOP_UNAPPLIED_NOTICE);
      return null;
    }
    await stop({
      ...target,
      conversationId: task.conversationId ?? task.id,
      latestTaskId: task.id,
    });
    return task;
  }

  async function executeOwned(
    gateway: RemoteRunnerGateway,
    request: Request,
    target: RemoteAgentMutationTarget,
    continuation: boolean,
    targetKey: string,
  ): Promise<RemoteRunnerTask | null> {
    const launch = agentLaunchWithoutBrowser(request.launch);
    const signature = JSON.stringify([
      continuation,
      "isolation" in request ? request.isolation : null,
      request.prompt,
      launch,
      request.attachments ?? [],
      request.attachmentOwner ?? null,
    ]);
    let command = pending.current.get(targetKey);
    let dispatched = false;
    try {
      if (command && command.signature !== signature)
        throw new Error(
          "Retry the original message before changing it or starting another conversation.",
        );
      const provider: RemoteRunnerProvider = launch.provider === "claudeCode" ? "claude" : "codex";
      if (!command) {
        if (
          (!request.prompt.trim() && !request.attachments?.length) ||
          request.prompt.includes("\0") ||
          new TextEncoder().encode(request.prompt).byteLength > 48000 ||
          (request.attachments?.length ?? 0) > 8
        )
          throw new Error("Enter a prompt and use at most eight images.");
        if (pending.current.size >= 32)
          throw new Error("Resolve pending remote messages before starting another conversation.");
        let isolation: "worktree" | "in-place" =
          "isolation" in request ? request.isolation : "worktree";
        let sendIsolation = false;
        if (!continuation) {
          const descriptor = await gateway.getRunner({ serverId: target.serverId });
          if (!valid()) return null;
          if (descriptor.runnerId !== target.runnerId)
            throw new Error("The remote runner changed. Reconnect before starting.");
          sendIsolation = descriptor.capabilities.taskIsolation === true;
          if (isolation === "in-place" && !sendIsolation)
            throw new Error("Update the server runner to use the server checkout.");
        }
        if (continuation) {
          if (!target.latestTaskId || !target.conversationId)
            throw new Error("Select a remote conversation to continue.");
          const parent = await gateway.getTask({
            serverId: target.serverId,
            taskId: target.latestTaskId,
          });
          if (!valid()) return null;
          if (
            parent.id !== target.latestTaskId ||
            parent.runnerId !== target.runnerId ||
            parent.projectId !== target.projectId ||
            parent.provider !== provider ||
            (parent.conversationId ?? parent.id) !== target.conversationId
          )
            throw new Error("The remote conversation changed. Refresh before continuing.");
          isolation = parent.isolation ?? "worktree";
          const resume = await gateway.getTaskResume({
            serverId: target.serverId,
            taskId: target.latestTaskId,
          });
          if (!valid()) return null;
          if (!resume.available)
            throw new Error("This remote conversation cannot currently be continued.");
        }
        let attachments: readonly RemoteRunnerPart[] = [];
        if (request.attachments?.length) {
          if (!options.resolveAttachments)
            throw new Error("Remote image attachment upload is unavailable.");
          attachments = await options.resolveAttachments(request, target.serverId);
          if (!valid()) return null;
          if (
            attachments.length !== request.attachments.length ||
            attachments.some((part) => part.type !== "attachment") ||
            new Set(
              attachments.map((part) => (part.type === "attachment" ? part.attachmentId : "")),
            ).size !== attachments.length
          )
            throw new Error("The remote image upload returned invalid attachments.");
        }
        const instructions = await collectRemoteInstructions(gateway, target, valid, provider);
        if (!valid()) return null;
        command = {
          instructions,
          isolation,
          sendIsolation,
          signature,
          parentTaskId: continuation ? target.latestTaskId : undefined,
          idempotencyKey: crypto.randomUUID(),
          parts: [
            ...(request.prompt.trim() ? [{ type: "text" as const, text: request.prompt }] : []),
            ...attachments,
          ],
        };
      }
      if (!valid()) return null;
      pending.current.set(targetKey, command);
      dispatched = true;
      let task: RemoteRunnerTask;
      if (continuation) {
        const wire = {
          serverId: target.serverId,
          taskId: command.parentTaskId!,
          idempotencyKey: command.idempotencyKey,
          parts: command.parts,
          ...(command.instructions ? { instructions: command.instructions } : {}),
          launch,
        };
        task = (await gateway.continueTask(wire)).task;
        if (!valid()) return null;
        if (
          task.parentTaskId !== command.parentTaskId ||
          task.conversationId !== target.conversationId ||
          task.id === command.parentTaskId ||
          task.status === "draft"
        )
          throw new Error("The runner returned a different continuation.");
      } else {
        const wire = {
          serverId: target.serverId,
          idempotencyKey: command.idempotencyKey,
          provider,
          ...(command.sendIsolation ? { isolation: command.isolation } : {}),
          parts: command.parts,
          ...(command.instructions ? { instructions: command.instructions } : {}),
          launch,
        };
        task = (await gateway.createTask(wire)).task;
        if (!valid()) return null;
        if (
          (task.isolation ?? "worktree") !== command.isolation ||
          task.runnerId !== target.runnerId ||
          task.provider !== provider ||
          !sameLaunch(task, launch) ||
          !sameParts(task.parts, command.parts) ||
          task.parentTaskId ||
          (task.conversationId !== undefined && task.conversationId !== task.id) ||
          (command.draftId && task.id !== command.draftId)
        )
          throw new Error("The runner returned a different task draft.");
        command.draftId = task.id;
        if (task.status === "draft") {
          task = await gateway.startTask({
            serverId: target.serverId,
            taskId: task.id,
            projectId: target.projectId,
          });
          if (!valid()) return null;
        }
        if (
          task.id !== command.draftId ||
          task.status === "draft" ||
          task.parentTaskId ||
          (task.conversationId !== undefined && task.conversationId !== task.id)
        )
          throw new Error("The runner did not confirm the task start.");
      }
      if (
        (task.isolation ?? "worktree") !== command.isolation ||
        task.runnerId !== target.runnerId ||
        task.provider !== provider ||
        task.projectId !== target.projectId ||
        !sameLaunch(task, launch) ||
        !sameParts(task.parts, command.parts)
      )
        throw new Error("The runner returned a different remote task.");
      pending.current.delete(targetKey);
      options.publish(target.serverId, task);
      return task;
    } catch (error) {
      if (valid()) {
        if (dispatched && isRemoteRunnerRequestRejectedError(error) && !command?.draftId)
          pending.current.delete(targetKey);
        options.report(
          pending.current.has(targetKey)
            ? "Remote execution was not confirmed. Retry the same message to recover it safely."
            : remoteRunnerErrorMessage(error, "Remote execution failed."),
        );
      }
      return null;
    }
  }
  function stop(target: RemoteAgentMutationTarget): Promise<void> {
    const gateway = options.gateway;
    if (!gateway || !valid()) return Promise.resolve();
    const targetKey = key(target);
    const execution = executions.current.get(targetKey);
    if (execution !== undefined) {
      execution.stopAfter = true;
      return Promise.resolve();
    }
    const latestTaskId = target.latestTaskId;
    if (!latestTaskId) return Promise.resolve();
    const stopKey = JSON.stringify([targetKey, latestTaskId]);
    const existing = stops.current.get(stopKey);
    if (existing !== undefined) return existing;
    if (stops.current.size >= MAX_REMOTE_IN_FLIGHT_MUTATIONS) {
      options.report(REMOTE_MUTATIONS_FULL_NOTICE);
      return Promise.resolve();
    }
    const running = cancelOwned(gateway, target, latestTaskId).finally(() => {
      stops.current.delete(stopKey);
      publishActivity();
    });
    stops.current.set(stopKey, running);
    publishActivity();
    return running;
  }
  async function cancelOwned(
    gateway: RemoteRunnerGateway,
    target: RemoteAgentMutationTarget,
    latestTaskId: string,
  ): Promise<void> {
    try {
      const task = await gateway.getTask({
        serverId: target.serverId,
        taskId: latestTaskId,
      });
      if (!valid()) return;
      if (
        task.id !== latestTaskId ||
        task.runnerId !== target.runnerId ||
        task.projectId !== target.projectId ||
        (task.conversationId ?? task.id) !== target.conversationId
      )
        throw new Error("The remote conversation changed. Refresh before stopping it.");
      const stopped = await gateway.cancelTask({ serverId: target.serverId, taskId: task.id });
      if (!valid()) return;
      if (
        stopped.id !== task.id ||
        stopped.runnerId !== task.runnerId ||
        stopped.projectId !== task.projectId ||
        stopped.provider !== task.provider ||
        (stopped.isolation ?? "worktree") !== (task.isolation ?? "worktree") ||
        stopped.conversationId !== task.conversationId ||
        stopped.parentTaskId !== task.parentTaskId
      )
        throw new Error("The runner returned a different stopped task.");
      options.publish(target.serverId, stopped);
    } catch (error) {
      if (valid())
        options.report(remoteRunnerErrorMessage(error, "Could not stop remote execution."));
    }
  }
  return {
    busy: busyKeys.size > 0 || stopping,
    busyKeys,
    start: (
      request: AgentThreadStartRequest,
      target: RemoteAgentMutationTarget,
      dispatchKey: string = key(target),
    ) => execute(request, target, false, dispatchKey),
    followUp: (
      request: AgentFollowUpRequest,
      target: RemoteAgentMutationTarget,
      dispatchKey: string = key(target),
    ) => execute(request, target, true, dispatchKey),
    stop,
  };
}
