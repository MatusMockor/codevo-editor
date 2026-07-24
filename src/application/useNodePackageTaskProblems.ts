import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodePackageTaskOwner } from "../domain/nodePackageScripts";
import {
  nodePackageTaskOwnersEqual,
  nodePackageTaskProblemsToNotices,
  reduceNodePackageTaskOutput,
  reduceNodePackageTaskProblems,
  type NodePackageTaskOutputEvent,
  type NodePackageTaskProblemsGateway,
  type NodePackageTaskProblemsState,
  type NodePackageTaskOutputState,
} from "../domain/nodePackageTaskProblems";
import type { NodePackageTaskState } from "./nodePackageTaskLifecycle";

interface UseNodePackageTaskProblemsOptions {
  readonly enabled: boolean;
  readonly gateway: NodePackageTaskProblemsGateway;
  readonly rootPath: string | null;
  readonly task: NodePackageTaskState | null;
  readonly workspaceId: string | null;
  onOutput?(event: NodePackageTaskOutputEvent): void;
  reportError?(error: unknown): void;
}

export function useNodePackageTaskProblems({
  enabled,
  gateway,
  onOutput,
  reportError,
  rootPath,
  task,
  workspaceId,
}: UseNodePackageTaskProblemsOptions) {
  const subscriptionReadiness = useMemo(deferredReadiness, [enabled, gateway]);
  void subscriptionReadiness.promise.catch(() => undefined);
  const [state, setState] = useState<NodePackageTaskProblemsState | null>(null);
  const stateRef = useRef<NodePackageTaskProblemsState | null>(null);
  const outputStateRef = useRef<NodePackageTaskOutputState | null>(null);
  const mountedRef = useRef(false);
  const scopeRef = useRef({ rootPath, workspaceId });
  const currentRef = useRef({ enabled, onOutput, reportError, rootPath, workspaceId });
  currentRef.current = { enabled, onOutput, reportError, rootPath, workspaceId };

  const transition = useCallback((next: NodePackageTaskProblemsState | null) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      subscriptionReadiness.resolve();
      return () => {
        mountedRef.current = false;
        stateRef.current = null;
        outputStateRef.current = null;
      };
    }
    const deactivateReadiness = subscriptionReadiness.activate();
    let disposed = false;
    let unsubscribeOutput: (() => void) | null = null;
    let unsubscribeProblems: (() => void) | null = null;

    const subscribe = async () => {
      try {
        const outputSubscription = await gateway.subscribeNodePackageTaskOutputEvents((event) => {
          const current = currentRef.current;
          const owner = stateRef.current?.owner;
          if (
            !mountedRef.current ||
            !current.enabled ||
            !owner ||
            !nodePackageTaskOwnersEqual(owner, event.owner) ||
            event.sequence <= (outputStateRef.current?.sequence ?? 0)
          )
            return;
          const previous = outputStateRef.current;
          const next = reduceNodePackageTaskOutput(previous, { type: "event", event });
          outputStateRef.current = next;
          if (next === previous) return;
          if (!previous?.truncated && next?.truncated) {
            current.onOutput?.({ ...event, data: "", truncated: true });
          } else if (!next?.truncated) {
            current.onOutput?.(event);
          }
        });
        if (disposed) {
          outputSubscription();
          return;
        }
        unsubscribeOutput = outputSubscription;
        const problemsSubscription = await gateway.subscribeNodePackageTaskProblemsEvents(
          (event) => {
            if (!mountedRef.current || !currentRef.current.enabled) return;
            const next = reduceNodePackageTaskProblems(stateRef.current, { type: "event", event });
            if (next !== stateRef.current) transition(next);
          },
        );
        if (disposed) {
          problemsSubscription();
          return;
        }
        unsubscribeProblems = problemsSubscription;
        subscriptionReadiness.resolve();
      } catch (error) {
        unsubscribeOutput?.();
        unsubscribeProblems?.();
        if (disposed) return;
        subscriptionReadiness.reject(error);
        throw error;
      }
    };

    void subscribe().catch((error: unknown) => {
      if (!disposed) currentRef.current.reportError?.(error);
    });
    return () => {
      disposed = true;
      deactivateReadiness();
      mountedRef.current = false;
      unsubscribeOutput?.();
      unsubscribeProblems?.();
      stateRef.current = null;
      outputStateRef.current = null;
    };
  }, [enabled, gateway, subscriptionReadiness, transition]);

  useEffect(() => {
    const previousScope = scopeRef.current;
    scopeRef.current = { rootPath, workspaceId };
    if (previousScope.rootPath !== rootPath || previousScope.workspaceId !== workspaceId) {
      transition(null);
      outputStateRef.current = null;
    }
    if (!enabled || !rootPath || !workspaceId || !task || task.status === "stopped") {
      transition(null);
      outputStateRef.current = null;
      return;
    }
    if (task.workspaceId !== workspaceId) {
      transition(null);
      outputStateRef.current = null;
      return;
    }
    if (task.sessionId !== null) {
      const owner: NodePackageTaskOwner = {
        runId: task.runId,
        workspaceId: task.workspaceId,
        sessionId: task.sessionId,
        manifestRelativePath: task.manifestRelativePath,
        scriptName: task.scriptName,
      };
      const next = reduceNodePackageTaskProblems(stateRef.current, { type: "own", owner });
      if (next !== stateRef.current) {
        outputStateRef.current = reduceNodePackageTaskOutput(null, { type: "own", owner });
        transition(next);
      }
    }
    // Exited tasks deliberately retain the final complete snapshot.
  }, [enabled, rootPath, task, transition, workspaceId]);

  const notices = useMemo(
    () => (rootPath ? nodePackageTaskProblemsToNotices(state, rootPath) : []),
    [rootPath, state],
  );
  return { notices, ready: subscriptionReadiness.promise, state };
}

function deferredReadiness() {
  let activation = 0;
  let settled = false;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    };
    reject = (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
  });
  return {
    activate: () => {
      const currentActivation = ++activation;
      return () => {
        queueMicrotask(() => {
          // StrictMode immediately replays effects. A newer activation keeps the
          // same gate alive; a real unmount or gateway replacement cancels it.
          if (activation === currentActivation) {
            const error = new Error("Node package task subscriptions were cancelled.");
            error.name = "AbortError";
            reject(error);
          }
        });
      };
    },
    promise,
    reject,
    resolve,
  };
}
