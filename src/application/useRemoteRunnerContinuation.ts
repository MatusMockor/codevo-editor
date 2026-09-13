import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type {
  RemoteRunnerGateway,
  RemoteRunnerPart,
  RemoteRunnerTask,
  RemoteRunnerTaskResume,
} from "../domain/remoteRunner";
import type { RemoteRunnerSubmission } from "./useRemoteRunnerTasks";
import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { isRemoteTaskTerminal } from "./remoteRunnerTaskState";

type Pending = {
  readonly task: RemoteRunnerTask;
  readonly signature: string;
  readonly idempotencyKey: string;
  readonly parts: readonly RemoteRunnerPart[];
};
interface Options {
  gateway: RemoteRunnerGateway;
  serverId: string | null;
  owner: object;
  supported: boolean;
  selectedTask: RemoteRunnerTask | null;
  selection: MutableRefObject<number>;
  mutation: MutableRefObject<boolean>;
  valid(owner: object): boolean;
  publish(task: RemoteRunnerTask): void;
  setBusy(busy: boolean): void;
  setError(error: string | null): void;
}

/** Retains the exact dispatched command until an uncertain response can be retried safely. */
export function useRemoteRunnerContinuation(options: Options) {
  const {
    gateway,
    serverId,
    owner,
    supported,
    selectedTask,
    selection,
    mutation,
    valid,
    publish,
    setBusy,
    setError,
  } = options;
  const renderSelection = selection.current;
  const pending = useRef<Pending | null>(null);
  const pendingOwner = useRef(owner);
  if (pendingOwner.current !== owner) {
    pendingOwner.current = owner;
    pending.current = null;
  }
  const [resume, setResume] = useState<RemoteRunnerTaskResume | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [revision, setRevision] = useState(0);
  const status = selectedTask?.status;
  const taskId = selectedTask?.id;
  useEffect(() => {
    setResume(null);
    setUncertain(pending.current !== null);
    if (!supported || !selectedTask || !isRemoteTaskTerminal(selectedTask) || serverId === null)
      return;
    let disposed = false;
    const selected = selection.current;
    const current = () => !disposed && valid(owner) && selection.current === selected;
    void gateway.getTaskResume({ serverId, taskId: selectedTask.id }).then(
      (result) => {
        if (current()) setResume(result);
      },
      (failure: unknown) => {
        if (current())
          setError(
            failure instanceof Error ? failure.message : "Could not check session continuation.",
          );
      },
    );
    return () => {
      disposed = true;
    };
  }, [gateway, serverId, owner, supported, taskId, status, revision, selection, valid, setError]);

  const continueTask = useCallback(
    async (input?: RemoteRunnerSubmission): Promise<RemoteRunnerTask | null> => {
      const task = selectedTask;
      if (
        !valid(owner) ||
        selection.current !== renderSelection ||
        !supported ||
        serverId === null ||
        !task ||
        mutation.current
      )
        return null;
      const previous = pending.current;
      if (!previous && (!input || !resume?.available || !isRemoteTaskTerminal(task))) return null;
      const signature = input === undefined ? previous?.signature : JSON.stringify(input);
      if (previous && (previous.task.id !== task.id || previous.signature !== signature)) {
        setError("Retry the original message before changing it or starting another conversation.");
        return null;
      }
      if (input && (input.provider !== task.provider || input.projectId !== task.projectId)) {
        setError("Continue using the original provider and project.");
        return null;
      }
      const selected = renderSelection;
      const current = () => valid(owner) && selection.current === selected;
      mutation.current = true;
      setBusy(true);
      setError(null);
      try {
        let command = previous;
        if (!command) {
          if (
            !input ||
            (!input.prompt.trim() && !input.attachments.length) ||
            new TextEncoder().encode(input.prompt).byteLength > 48000 ||
            input.attachments.length > 8
          )
            throw new Error("Enter a prompt and use at most eight images.");
          const parts: RemoteRunnerPart[] = input.prompt.trim()
            ? [{ type: "text", text: input.prompt }]
            : [];
          for (const attachment of input.attachments) {
            if (!current()) return null;
            const attachmentId = crypto.randomUUID();
            const uploaded = await gateway.uploadAttachment({
              serverId,
              attachmentId,
              ...attachment,
            });
            if (!current()) return null;
            if (
              uploaded.attachment.id !== attachmentId ||
              uploaded.attachment.runnerId !== task.runnerId
            )
              throw new Error("The runner returned a different attachment.");
            parts.push({ type: "attachment", attachmentId });
          }
          command = { task, signature: signature!, idempotencyKey: crypto.randomUUID(), parts };
        }
        if (!current()) return null;
        pending.current = command;
        const response = await gateway.continueTask({
          serverId,
          taskId: task.id,
          idempotencyKey: command.idempotencyKey,
          parts: command.parts,
        });
        if (!current()) return null;
        const next = response.task;
        if (
          next.id === task.id ||
          next.sequence <= task.sequence ||
          next.runnerId !== task.runnerId ||
          next.provider !== task.provider ||
          next.projectId !== task.projectId ||
          next.parentTaskId !== task.id ||
          next.conversationId !== (task.conversationId ?? task.id) ||
          next.status === "draft" ||
          next.parts.length !== command.parts.length ||
          next.parts.some((part, index) => {
            const expected = command.parts[index];
            return part.type === "text"
              ? expected?.type !== "text" || part.text !== expected.text
              : expected?.type !== "attachment" || part.attachmentId !== expected.attachmentId;
          })
        )
          throw new Error("The runner returned a different continuation.");
        pending.current = null;
        setUncertain(false);
        setResume(null);
        publish(next);
        return next;
      } catch (failure) {
        if (current()) {
          if (isRemoteRunnerRequestRejectedError(failure)) {
            pending.current = null;
            setResume(null);
            setRevision((value) => value + 1);
          }
          setUncertain(pending.current !== null);
          setError(
            pending.current
              ? "Continuation was not confirmed. Retry the same message or refresh to recover it safely."
              : failure instanceof Error
                ? failure.message
                : "Could not continue the remote session.",
          );
        }
        return null;
      } finally {
        if (valid(owner)) {
          mutation.current = false;
          setBusy(false);
        }
      }
    },
    [
      gateway,
      serverId,
      owner,
      supported,
      selectedTask,
      renderSelection,
      selection,
      mutation,
      valid,
      publish,
      setBusy,
      setError,
      resume,
    ],
  );
  return {
    resume,
    uncertain,
    locked: () => pending.current !== null,
    continueTask,
    reconcile: async () => {
      if (pending.current !== null) await continueTask();
      else setRevision((value) => value + 1);
    },
  };
}
