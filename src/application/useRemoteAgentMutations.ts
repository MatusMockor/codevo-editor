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
import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";

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
function sameLaunch(task: RemoteRunnerTask, request: Request): boolean {
  const actual = task.launch;
  const expected = request.launch;
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
  readonly parentTaskId?: string;
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
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
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

  async function execute(
    request: Request,
    target: RemoteAgentMutationTarget,
    continuation: boolean,
  ): Promise<RemoteRunnerTask | null> {
    const gateway = options.gateway;
    if (!gateway || !valid() || active.current) return null;
    active.current = true;
    setBusy(true);
    const targetKey = key(target);
    const signature = JSON.stringify([
      continuation,
      request.prompt,
      request.launch,
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
      const provider: RemoteRunnerProvider =
        request.launch.provider === "claudeCode" ? "claude" : "codex";
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
        command = {
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
          launch: request.launch,
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
          parts: command.parts,
          launch: request.launch,
        };
        task = (await gateway.createTask(wire)).task;
        if (!valid()) return null;
        if (
          task.runnerId !== target.runnerId ||
          task.provider !== provider ||
          !sameLaunch(task, request) ||
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
        task.runnerId !== target.runnerId ||
        task.provider !== provider ||
        task.projectId !== target.projectId ||
        !sameLaunch(task, request) ||
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
            : error instanceof Error
              ? error.message
              : "Remote execution failed.",
        );
      }
      return null;
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function stop(target: RemoteAgentMutationTarget): Promise<void> {
    const gateway = options.gateway;
    if (!gateway || !target.latestTaskId || !valid() || active.current) return;
    active.current = true;
    setBusy(true);
    try {
      const task = await gateway.getTask({
        serverId: target.serverId,
        taskId: target.latestTaskId,
      });
      if (!valid()) return;
      if (
        task.id !== target.latestTaskId ||
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
        stopped.conversationId !== task.conversationId ||
        stopped.parentTaskId !== task.parentTaskId
      )
        throw new Error("The runner returned a different stopped task.");
      options.publish(target.serverId, stopped);
    } catch (error) {
      if (valid())
        options.report(error instanceof Error ? error.message : "Could not stop remote execution.");
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    busy,
    start: (request: AgentThreadStartRequest, target: RemoteAgentMutationTarget) =>
      execute(request, target, false),
    followUp: (request: AgentFollowUpRequest, target: RemoteAgentMutationTarget) =>
      execute(request, target, true),
    stop,
  };
}
