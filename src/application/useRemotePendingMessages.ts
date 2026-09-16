import { collectRemoteInstructions } from "./collectRemoteInstructions";
import type { RemoteRunnerInstructionSnapshot } from "../domain/remoteRunnerInstructions";
import { agentLaunchWithoutBrowser } from "../domain/agentLaunch";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentFollowUpRequest, AgentSteerRequest, AgentThreadView } from "./agentThreadPorts";
import type { DeferredFollowUp, DeferredFollowUps } from "./agentDeferredFollowUps";
import type {
  RemoteRunnerGateway,
  RemoteRunnerPart,
  RemoteRunnerPendingMessage,
} from "../domain/remoteRunner";
import type { RemotePendingUpdate } from "./useRemoteAgentInventory";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";

interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly owner: object;
  valid(owner: object): boolean;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly views: ReadonlyMap<string, AgentThreadView>;
  resolveAttachments(
    request: AgentSteerRequest,
    serverId: string,
  ): Promise<readonly RemoteRunnerPart[]>;
  publish(serverId: string, threadId: string, items: RemotePendingUpdate): void;
  refresh(): Promise<void>;
  report(message: string): void;
}
function launchIdentity(
  launch: NonNullable<RemoteRunnerPendingMessage["launch"]>,
): readonly unknown[] {
  return launch.provider === "claudeCode"
    ? [
        launch.provider,
        launch.model,
        launch.mode,
        launch.effort,
        launch.context ?? "200k",
        launch.fastMode ?? false,
        launch.thinkingMode ?? false,
      ]
    : [launch.provider, launch.model, launch.mode];
}
function sameLaunch(
  left: RemoteRunnerPendingMessage["launch"],
  right: RemoteRunnerPendingMessage["launch"],
): boolean {
  return left && right
    ? JSON.stringify(launchIdentity(left)) === JSON.stringify(launchIdentity(right))
    : left === right;
}
type Command = {
  taskId: string;
  signature: string;
  idempotencyKey: string;
  parts: readonly RemoteRunnerPart[];
  readonly instructions?: RemoteRunnerInstructionSnapshot;
};

/** The server owns FIFO execution; the editor retains only exact uncertain enqueue commands. */
export function useRemotePendingMessages(options: Options) {
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
  const entries = useMemo(() => {
    const result = new Map<string, readonly RemoteRunnerPendingMessage[]>();
    for (const snapshot of options.snapshots)
      for (const [id, items] of snapshot.pendingMessages ?? []) result.set(id, items);
    return result;
  }, [options.snapshots]);
  const deferred = useMemo<DeferredFollowUps>(() => {
    const result = new Map<string, readonly DeferredFollowUp[]>();
    for (const [threadId, items] of entries) {
      const view = options.views.get(threadId);
      const fallback = view?.thread.turns[view.thread.turns.length - 1]?.launch;
      result.set(
        threadId,
        items.flatMap((item) => {
          const launch = item.launch ?? fallback;
          if (!launch) return [];
          return [
            {
              id: item.id,
              state: item.status === "paused" ? ("paused" as const) : ("queued" as const),
              queuedAtEpochMs: Date.parse(item.createdAt),
              displayAttachmentCount: item.parts.filter((part) => part.type === "attachment")
                .length,
              request: {
                threadId,
                launch,
                prompt:
                  item.parts
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("\n\n") || "Image attachment",
              },
            },
          ];
        }),
      );
    }
    return result;
  }, [entries, options.views]);
  function target(threadId: string) {
    const view = latest.current.views.get(threadId);
    const execution = view?.execution;
    const snapshot = latest.current.snapshots.find((item) => item.serverId === execution?.serverId);
    if (
      !execution ||
      !snapshot?.connected ||
      snapshot.descriptor?.runnerId !== execution.runnerId ||
      !snapshot.descriptor.capabilities.pendingMessages ||
      view.thread.archived
    )
      throw new Error("Reconnect and update this server to queue messages.");
    return execution;
  }
  async function enqueue(request: AgentSteerRequest | AgentFollowUpRequest): Promise<boolean> {
    const gateway = options.gateway;
    if (!gateway?.enqueueMessage || !valid() || active.current) return false;
    active.current = true;
    setBusy(true);
    let command: Command | undefined;
    let commandKey = "";
    let dispatched = false;
    try {
      const execution = target(request.threadId);
      const rawLaunch =
        "launch" in request
          ? request.launch
          : (() => {
              const turns = options.views.get(request.threadId)?.thread.turns;
              return turns?.[turns.length - 1]?.launch;
            })();
      if (!rawLaunch)
        throw new Error("This conversation has no model settings for queued messages.");
      const launch = agentLaunchWithoutBrowser(rawLaunch);
      if (options.views.get(request.threadId)?.thread.provider.kind !== launch.provider)
        throw new Error("Use this conversation's provider for queued messages.");
      commandKey = `${execution.serverId}:${execution.runnerId}:${execution.conversationId}`;
      const signature = JSON.stringify([
        request.prompt,
        launchIdentity(launch),
        request.attachments ?? [],
        request.attachmentOwner ?? null,
      ]);
      command = uncertain.current.get(commandKey);
      if (command && command.signature !== signature)
        throw new Error("Retry the original queued message before changing it.");
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
        const attachments = request.attachments?.length
          ? await options.resolveAttachments(request, execution.serverId)
          : [];
        if (!valid()) return false;
        if (
          attachments.length !== (request.attachments?.length ?? 0) ||
          attachments.some((part) => part.type !== "attachment")
        )
          throw new Error("The remote image upload returned invalid attachments.");
        const instructions = await collectRemoteInstructions(
          gateway,
          execution,
          valid,
          launch.provider === "claudeCode" ? "claude" : "codex",
        );
        if (!valid()) return false;
        command = {
          instructions,
          signature,
          taskId: execution.latestTaskId,
          idempotencyKey: crypto.randomUUID(),
          parts: [
            ...(request.prompt.trim() ? [{ type: "text" as const, text: request.prompt }] : []),
            ...attachments,
          ],
        };
      }
      if (!valid()) return false;
      target(request.threadId);
      uncertain.current.set(commandKey, command);
      dispatched = true;
      const response = await gateway.enqueueMessage({
        serverId: execution.serverId,
        taskId: command.taskId,
        idempotencyKey: command.idempotencyKey,
        parts: command.parts,
        ...(command.instructions ? { instructions: command.instructions } : {}),
        launch,
      });
      if (!valid()) return false;
      target(request.threadId);
      const item = response.pending;
      const expectedParts = command.parts;
      if (
        item.conversationId !== execution.conversationId ||
        item.parts.length !== command.parts.length ||
        item.parts.some((part, index) => {
          const expected = expectedParts[index];
          return part.type === "text"
            ? expected?.type !== "text" || expected.text !== part.text
            : expected?.type !== "attachment" || expected.attachmentId !== part.attachmentId;
        }) ||
        !sameLaunch(item.launch, launch)
      )
        throw new Error("The runner returned a different queued message.");
      uncertain.current.delete(commandKey);
      options.publish(execution.serverId, request.threadId, (values) => [
        ...values.filter((entry) => entry.id !== item.id),
        ...(["queued", "paused"].includes(item.status) ? [item] : []),
      ]);
      void options.refresh();
      return true;
    } catch (error) {
      if (valid()) {
        if (dispatched && isRemoteRunnerRequestRejectedError(error))
          uncertain.current.delete(commandKey);
        options.report(
          uncertain.current.has(commandKey)
            ? "Queue delivery was not confirmed. Retry the same message to recover it safely."
            : error instanceof Error
              ? error.message
              : "Could not queue the message.",
        );
      }
      return false;
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function mutate(threadId: string, pendingId?: string): Promise<void> {
    const gateway = options.gateway;
    if (!gateway || !valid() || active.current) return;
    active.current = true;
    setBusy(true);
    try {
      const execution = target(threadId);
      const request = { serverId: execution.serverId, taskId: execution.latestTaskId };
      if (pendingId !== undefined) {
        if (!gateway.cancelPendingMessage)
          throw new Error("Removing queued messages is unavailable.");
        const item = await gateway.cancelPendingMessage({ ...request, pendingId });
        if (!valid()) return;
        if (
          item.id !== pendingId ||
          item.conversationId !== execution.conversationId ||
          item.status !== "cancelled"
        )
          throw new Error("The runner did not confirm removing the queued message.");
        options.publish(execution.serverId, threadId, (values) =>
          values.filter((entry) => entry.id !== pendingId),
        );
      } else {
        if (!gateway.resumePendingMessages)
          throw new Error("Resuming queued messages is unavailable.");
        const page = await gateway.resumePendingMessages(request);
        if (!valid()) return;
        target(threadId);
        if (page.items.some((item) => item.conversationId !== execution.conversationId))
          throw new Error("The runner returned another conversation's queue.");
        options.publish(execution.serverId, threadId, page.items);
      }
      void options.refresh();
    } catch (error) {
      if (valid())
        options.report(
          error instanceof Error
            ? error.message
            : "Queue change was not confirmed. Refresh to inspect its current state.",
        );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    busy,
    deferred,
    enqueue,
    remove: (threadId: string, id: string) => mutate(threadId, id),
    resume: (threadId: string) => mutate(threadId),
  };
}
