import type { AgentProviderUpdateProgressEvent } from "../../domain/agentProviderHealth";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  boundedProgressSubscription,
  idempotentUnlisten,
  runningUpdateWith,
} from "../agentProviderUpdateRun";
import { publishProvider, type AgentProviderManagementState } from "./agentProviderManagementState";
import type { ProviderOwner } from "./agentProviderRuntime";

export interface AgentProviderUpdateProgressSession {
  onProgress(event: AgentProviderUpdateProgressEvent): void;
  markUncertain(error: unknown): void;
  accept(
    subscription: Awaited<ReturnType<typeof boundedProgressSubscription>>,
    subscriptionPromise: Promise<() => void>,
  ): "listening" | "abandoned";
  close(): void;
}

export function createAgentProviderUpdateProgressSession(
  state: AgentProviderManagementState,
  provider: AgentCliKind,
  operationId: string,
  updateOwner: ProviderOwner,
  operationIsCurrent: () => boolean,
): AgentProviderUpdateProgressSession {
  let progressClosed = false;
  let nextProgressSequence = 1;
  let unlistenProgress: (() => void) | null = null;
  const progressIsCurrent = (): boolean => !progressClosed && operationIsCurrent();
  const markProgressUncertain = (error: unknown): void => {
    if (!progressIsCurrent()) return;
    progressClosed = true;
    publishProvider(state, provider, (current) => ({
      ...current,
      updateState: runningUpdateWith(current.updateState, operationId, "", true),
    }));
    state.dependenciesRef.current.reportError("Agent provider update progress", error);
  };
  const onProgress = (event: AgentProviderUpdateProgressEvent): void => {
    if (!progressIsCurrent()) return;
    if (
      event.provider !== provider ||
      event.providerGeneration !== updateOwner.providerGeneration ||
      event.operationId !== operationId
    ) {
      return;
    }
    if (event.sequence !== nextProgressSequence) {
      markProgressUncertain(
        new Error("Agent provider update progress was duplicated, reordered, or incomplete."),
      );
      return;
    }
    nextProgressSequence += 1;
    publishProvider(state, provider, (current) => ({
      ...current,
      updateState: runningUpdateWith(
        current.updateState,
        operationId,
        `${event.data}\n`,
        event.truncated,
      ),
    }));
  };

  const accept = (
    subscription: Awaited<ReturnType<typeof boundedProgressSubscription>>,
    subscriptionPromise: Promise<() => void>,
  ): "listening" | "abandoned" => {
    if (subscription.kind === "timedOut") {
      markProgressUncertain(new Error("Agent provider update progress listener timed out."));
      void subscriptionPromise.then((lateUnlisten) => lateUnlisten()).catch(() => undefined);
    } else {
      unlistenProgress = idempotentUnlisten(subscription.unlisten);
    }
    if (unlistenProgress === null) return "listening";
    if (!operationIsCurrent()) {
      unlistenProgress();
      unlistenProgress = null;
      return "abandoned";
    }
    state.updateProgressUnlisten[provider] = { operationId, unlisten: unlistenProgress };
    return "listening";
  };

  const close = (): void => {
    progressClosed = true;
    const registeredUnlisten = state.updateProgressUnlisten[provider];
    if (registeredUnlisten?.operationId === operationId) {
      delete state.updateProgressUnlisten[provider];
    }
    if (unlistenProgress === null) return;
    try {
      unlistenProgress();
    } catch (error) {
      state.dependenciesRef.current.reportError("Agent provider update progress cleanup", error);
    }
  };

  return { onProgress, markUncertain: markProgressUncertain, accept, close };
}
