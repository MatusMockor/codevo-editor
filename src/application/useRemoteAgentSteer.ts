import { useEffect, useRef, useState } from "react";
import type { AgentSteerRequest, AgentThreadView } from "./agentThreadPorts";
import type { RemoteRunnerGateway, RemoteRunnerPart } from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import type { RemotePendingUpdate } from "./useRemoteAgentInventory";
import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";

interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly owner: object;
  readonly selectedThreadId: string | null;
  valid(owner: object): boolean;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly views: ReadonlyMap<string, AgentThreadView>;
  resolveAttachments(
    request: AgentSteerRequest,
    serverId: string,
  ): Promise<readonly RemoteRunnerPart[]>;
  publish(serverId: string, threadId: string, update: RemotePendingUpdate): void;
  refresh(): Promise<void>;
  report(message: string): void;
}
interface Command {
  readonly taskId: string;
  readonly signature: string;
  readonly idempotencyKey: string;
  readonly parts: readonly RemoteRunnerPart[];
}

/** Retains the exact server command after uncertain delivery; never silently requeues it. */
export function useRemoteAgentSteer(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(false);
  const active = useRef(false);
  const uncertain = useRef(new Map<string, Command>());
  const [busy, setBusy] = useState(false);
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
  function target(threadId: string) {
    const view = latest.current.views.get(threadId);
    const execution = view?.execution;
    const snapshot = latest.current.snapshots.find((item) => item.serverId === execution?.serverId);
    if (
      !execution ||
      !snapshot?.connected ||
      snapshot.descriptor?.runnerId !== execution.runnerId ||
      view.thread.archived
    )
      throw new Error("Reconnect this conversation's server to send a message now.");
    if (snapshot.descriptor.capabilities.taskSteering !== true)
      throw new Error("Update this server to send messages during a running turn.");
    return execution;
  }
  async function send(request: AgentSteerRequest): Promise<boolean> {
    if (!valid() || active.current) return false;
    active.current = true;
    setBusy(true);
    let key = "";
    let dispatched = false;
    try {
      const execution = target(request.threadId);
      const gateway = options.gateway;
      if (!gateway?.steerTask)
        throw new Error("Update the editor and server to send messages during a running turn.");
      key = `${execution.serverId}:${execution.runnerId}:${execution.conversationId}`;
      const signature = JSON.stringify([
        request.prompt,
        request.attachments ?? [],
        request.attachmentOwner ?? null,
      ]);
      let command = uncertain.current.get(key);
      const retryingUnconfirmed = command !== undefined;
      if (command && command.signature !== signature)
        throw new Error("Retry the original message before changing it.");
      if (!command) {
        if (
          (!request.prompt.trim() && !request.attachments?.length) ||
          request.prompt.includes("\0") ||
          new TextEncoder().encode(request.prompt).byteLength > 48000 ||
          (request.attachments?.length ?? 0) > 8
        )
          throw new Error("Enter a prompt and use at most eight images.");
        if (uncertain.current.size >= 32)
          throw new Error("Resolve unconfirmed remote messages first.");
        const parts = request.attachments?.length
          ? await options.resolveAttachments(request, execution.serverId)
          : [];
        if (!valid()) return false;
        if (
          parts.length !== (request.attachments?.length ?? 0) ||
          parts.some((part) => part.type !== "attachment")
        )
          throw new Error("The remote image upload returned invalid attachments.");
        command = {
          taskId: execution.latestTaskId,
          signature,
          idempotencyKey: crypto.randomUUID(),
          parts: [
            ...(request.prompt.trim() ? [{ type: "text" as const, text: request.prompt }] : []),
            ...parts,
          ],
        };
      }
      if (!valid()) return false;
      if (!retryingUnconfirmed && target(request.threadId).latestTaskId !== command.taskId)
        throw new Error(
          "The running turn changed. Confirm the original message before sending again.",
        );
      uncertain.current.set(key, command);
      dispatched = true;
      const response = await gateway.steerTask({
        serverId: execution.serverId,
        taskId: command.taskId,
        idempotencyKey: command.idempotencyKey,
        parts: command.parts,
      });
      if (!valid()) return false;
      target(request.threadId);
      if (
        response.taskId !== command.taskId ||
        response.messageId !== command.idempotencyKey ||
        response.status !== "accepted"
      )
        throw new Error("The runner returned a different message acknowledgement.");
      uncertain.current.delete(key);
      void options.refresh();
      return true;
    } catch (error) {
      if (valid()) {
        if (dispatched && isRemoteRunnerRequestRejectedError(error)) uncertain.current.delete(key);
        options.report(
          uncertain.current.has(key)
            ? "Message delivery was not confirmed. Retry the same message to recover it safely."
            : error instanceof Error
              ? error.message
              : "Could not send the message now.",
        );
      }
      return false;
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function sendPending(threadId: string, pendingId: string): Promise<void> {
    if (!valid() || active.current) return;
    active.current = true;
    setBusy(true);
    try {
      const execution = target(threadId);
      const pending = latest.current.snapshots
        .find((snapshot) => snapshot.serverId === execution.serverId)
        ?.pendingMessages?.get(threadId)
        ?.find((item) => item.id === pendingId);
      if (pending?.status === "uncertain")
        throw new Error(
          "Delivery could not be confirmed. Remove this message before sending it again.",
        );
      if (!options.gateway?.steerPendingMessage)
        throw new Error("Update the editor and server to send queued messages now.");
      const response = await options.gateway.steerPendingMessage({
        serverId: execution.serverId,
        taskId: execution.latestTaskId,
        pendingId,
      });
      if (!valid()) return;
      target(threadId);
      if (
        response.taskId !== execution.latestTaskId ||
        response.messageId !== pendingId ||
        response.status !== "accepted"
      )
        throw new Error("The runner did not confirm sending the queued message.");
      options.publish(execution.serverId, threadId, (items) =>
        items.filter((item) => item.id !== pendingId),
      );
      void options.refresh();
    } catch (error) {
      if (valid())
        options.report(
          error instanceof Error
            ? error.message
            : "Delivery was not confirmed. The queued message remains available to retry safely.",
        );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const hasUnconfirmed = (threadId: string) => {
    const execution = latest.current.views.get(threadId)?.execution;
    return (
      execution !== undefined &&
      uncertain.current.has(
        `${execution.serverId}:${execution.runnerId}:${execution.conversationId}`,
      )
    );
  };
  function discardUnconfirmed(threadId: string) {
    if (!valid() || active.current || latest.current.selectedThreadId !== threadId) return;
    const execution = latest.current.views.get(threadId)?.execution;
    if (!execution) return;
    uncertain.current.delete(
      `${execution.serverId}:${execution.runnerId}:${execution.conversationId}`,
    );
    options.report(
      "Unconfirmed message dismissed. It may already have been delivered; dismissing does not undo it.",
    );
  }
  return { busy, send, sendPending, hasUnconfirmed, discardUnconfirmed };
}
