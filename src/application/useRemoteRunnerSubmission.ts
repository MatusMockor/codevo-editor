import { useRef, type MutableRefObject } from "react";
import type {
  RemoteRunnerCreateTaskRequest,
  RemoteRunnerDescriptor,
  RemoteRunnerGateway,
  RemoteRunnerPart,
  RemoteRunnerProject,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { collectRemoteInstructions } from "./collectRemoteInstructions";
import type { RemoteRunnerSubmission } from "./useRemoteRunnerTasks";

interface Options {
  readonly gateway: RemoteRunnerGateway;
  readonly serverId: string | null;
  readonly owner: object;
  readonly descriptor: RemoteRunnerDescriptor | null;
  readonly mutation: MutableRefObject<boolean>;
  readonly refreshSequence: MutableRefObject<number>;
  readonly projects: MutableRefObject<readonly RemoteRunnerProject[]>;
  valid(owner: object): boolean;
  locked(): boolean;
  setLoading(value: boolean): void;
  setBusy(value: boolean): void;
  setError(value: string | null): void;
  publish(task: RemoteRunnerTask): void;
  choose(task: RemoteRunnerTask): void;
  poll(): void;
}
interface Pending {
  readonly projectId: string;
  readonly owner: object;
  readonly signature: string;
  readonly request: RemoteRunnerCreateTaskRequest;
  draftId?: string;
}

/** Keeps private instruction bytes and create identity fixed until delivery is confirmed. */
export function useRemoteRunnerSubmission(options: Options) {
  const pending = useRef<Pending | null>(null);
  if (pending.current && pending.current.owner !== options.owner) pending.current = null;
  const submit = async (input: RemoteRunnerSubmission): Promise<RemoteRunnerTask | null> => {
    const { gateway, serverId, owner, descriptor } = options;
    const valid = () => options.valid(owner);
    if (
      serverId === null ||
      !valid() ||
      options.mutation.current ||
      options.locked() ||
      !options.projects.current.some((project) => project.id === input.projectId)
    )
      return null;
    const signature = JSON.stringify(input);
    let command = pending.current?.owner === owner ? pending.current : null;
    options.mutation.current = true;
    options.refreshSequence.current++;
    options.setLoading(false);
    options.setBusy(true);
    options.setError(null);
    try {
      if (command && command.signature !== signature)
        throw new Error(
          "Retry the original message before changing it or starting another conversation.",
        );
      if (!command) {
        if (
          (!input.prompt.trim() && input.attachments.length === 0) ||
          new TextEncoder().encode(input.prompt).byteLength > 48000 ||
          input.attachments.length > 8
        )
          throw new Error("Enter a prompt and use at most eight images.");
        if (!descriptor) throw new Error("Reconnect to the server before sending a message.");
        const currentDescriptor = await gateway.getRunner({ serverId });
        if (!valid()) return null;
        if (currentDescriptor.runnerId !== descriptor.runnerId)
          throw new Error("The remote runner changed. Reconnect before starting.");
        const isolation = input.isolation ?? "worktree";
        const sendIsolation = currentDescriptor.capabilities.taskIsolation === true;
        if (isolation === "in-place" && !sendIsolation)
          throw new Error("Update the server runner to use the server checkout.");
        const parts: RemoteRunnerPart[] = input.prompt.trim()
          ? [{ type: "text", text: input.prompt }]
          : [];
        for (const attachment of input.attachments) {
          const attachmentId = crypto.randomUUID();
          const response = await gateway.uploadAttachment({
            serverId,
            attachmentId,
            ...attachment,
          });
          if (!valid()) return null;
          if (
            response.attachment.id !== attachmentId ||
            response.attachment.runnerId !== descriptor.runnerId
          )
            throw new Error("The runner returned a different attachment.");
          parts.push({ type: "attachment", attachmentId: response.attachment.id });
        }
        const instructions = await collectRemoteInstructions(
          gateway,
          { serverId, runnerId: descriptor.runnerId, projectId: input.projectId },
          valid,
          input.provider,
        );
        if (!valid()) return null;
        command = {
          projectId: input.projectId,
          owner,
          signature,
          request: {
            serverId,
            idempotencyKey: crypto.randomUUID(),
            provider: input.provider,
            ...(sendIsolation ? { isolation } : {}),
            parts,
            ...(instructions ? { instructions } : {}),
          },
        };
      }
      if (!valid()) return null;
      pending.current = command;
      const created = await gateway.createTask(command.request);
      if (!valid()) return null;
      if (
        (created.task.isolation ?? "worktree") !== (command.request.isolation ?? "worktree") ||
        created.task.parentTaskId !== undefined ||
        (created.task.conversationId !== undefined &&
          created.task.conversationId !== created.task.id) ||
        created.task.runnerId !== descriptor?.runnerId ||
        created.task.provider !== input.provider ||
        (command.draftId !== undefined && created.task.id !== command.draftId)
      )
        throw new Error("The runner returned a different task draft.");
      command.draftId = created.task.id;
      options.choose(created.task);
      options.publish(created.task);
      const started =
        created.task.status === "draft"
          ? await gateway.startTask({
              serverId,
              taskId: created.task.id,
              projectId: input.projectId,
            })
          : created.task;
      if (!valid()) return null;
      if (
        (started.isolation ?? "worktree") !== (command.request.isolation ?? "worktree") ||
        started.provider !== input.provider ||
        started.id !== created.task.id ||
        started.runnerId !== created.task.runnerId ||
        started.projectId !== input.projectId ||
        started.status === "draft"
      )
        throw new Error("The runner returned a different started task.");
      pending.current = null;
      options.publish(started);
      options.poll();
      return started;
    } catch (failure) {
      if (valid()) {
        if (isRemoteRunnerRequestRejectedError(failure) && !command?.draftId)
          pending.current = null;
        options.setError(
          failure instanceof Error ? failure.message : "The remote task operation failed.",
        );
      }
      return null;
    } finally {
      if (valid()) {
        options.mutation.current = false;
        options.setBusy(false);
      }
    }
  };
  return {
    submit,
    canStartDraft(taskId: string, projectId: string, isolation: "worktree" | "in-place"): boolean {
      return (
        pending.current?.owner === options.owner &&
        pending.current.draftId === taskId &&
        pending.current.projectId === projectId &&
        (pending.current.request.isolation ?? "worktree") === isolation &&
        (pending.current.request.provider === "codex" ||
          pending.current.request.instructions !== undefined)
      );
    },
    confirmStarted(task: RemoteRunnerTask) {
      if (
        options.valid(options.owner) &&
        pending.current?.owner === options.owner &&
        pending.current.draftId === task.id &&
        pending.current.projectId === task.projectId &&
        task.status !== "draft" &&
        (task.isolation ?? "worktree") === (pending.current.request.isolation ?? "worktree")
      )
        pending.current = null;
    },
  };
}
