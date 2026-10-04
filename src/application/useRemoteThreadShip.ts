import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  agentShipReducer,
  agentShipStatus,
  agentShipTransitionAllowed,
  initialAgentShipState,
  type AgentShipAction,
  type AgentShipFailure,
  type AgentShipState,
  type AgentShipStepResult,
} from "../domain/agentShip";
import type { GitShipStatus } from "../domain/gitIntegration";
import type {
  RemoteGitPushTarget,
  RemoteGitSyncPort,
  RemoteThreadGitStatus,
} from "../domain/remoteGitSync";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  errorMessageOf,
  failure,
  info,
  warning,
} from "./agentProjectAuthority";
import type { AgentTasksNotice } from "./agentThreadPorts";
import {
  REMOTE_SHIP_COMMIT_MESSAGE_INVALID,
  REMOTE_SHIP_PUSH_STATUS_UNAVAILABLE,
  REMOTE_SHIP_STEP_IN_FLIGHT_MESSAGE,
  REMOTE_SHIP_STOP_AGENT_MESSAGE,
  notRun,
  remoteCommitFailure,
  remoteCommitMessage,
  remotePushFailure,
  remotePushSettlement,
  remoteShipStatus,
  remoteShipStatusLoaded,
  remoteShipThreadKey,
  remoteStepFailure,
  sameRemoteShipTarget,
  type RemoteShipTarget,
} from "./remoteThreadShip";
import type { ExternalUrlOpenerPort } from "./useAgentShipFlow";

export interface RemoteThreadShipDependencies {
  readonly port: RemoteGitSyncPort | null;
  readonly resolve: (threadId: string) => RemoteShipTarget | null;
  readonly externalUrlOpener: ExternalUrlOpenerPort | null;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly onShipStepCompleted?: (threadId: string) => void;
}

export interface RemoteThreadShipSurface {
  readonly states: ReadonlyMap<string, AgentShipState>;
  readonly gitStatuses: ReadonlyMap<string, RemoteThreadGitStatus>;
  refreshShipStatus(threadId: string): Promise<void>;
  commit(threadId: string, message: string): Promise<AgentShipStepResult>;
  push(threadId: string, target?: RemoteGitPushTarget): Promise<AgentShipStepResult>;
  openCompareUrl(threadId: string): Promise<void>;
  resetShip(threadId: string): void;
  clear(threadId: string): void;
  retain(present: RemoteShipThreadPresence): void;
}

export interface RemoteShipThreadPresence {
  has(threadId: string): boolean;
}

interface Owner {
  readonly target: RemoteShipTarget;
  readonly port: RemoteGitSyncPort;
  readonly epoch: object;
}

const STEP_SUCCEEDED: AgentShipStepResult = Object.freeze({ kind: "succeeded" });

export function useRemoteThreadShip(
  dependencies: RemoteThreadShipDependencies,
): RemoteThreadShipSurface {
  const [states, setStates] = useState<ReadonlyMap<string, AgentShipState>>(() => new Map());
  const [gitStatuses, setGitStatuses] = useState<ReadonlyMap<string, RemoteThreadGitStatus>>(
    () => new Map(),
  );
  const dependenciesRef = useRef(dependencies);
  const statesRef = useRef(states);
  const gitStatusesRef = useRef(gitStatuses);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(new Set<string>());
  const epochRef = useRef(new Map<string, object>());
  const refreshRef = useRef(new Map<string, number>());
  const abortsRef = useRef(new Map<string, AbortController>());

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    const aborts = abortsRef.current;
    return () => {
      mountedRef.current = false;
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
    };
  }, []);

  const currentState = useCallback(
    (threadId: string): AgentShipState =>
      statesRef.current.get(threadId) ?? initialAgentShipState(null),
    [],
  );

  const publish = useCallback((threadId: string, next: AgentShipState): void => {
    if (!mountedRef.current) return;
    statesRef.current = new Map(statesRef.current).set(threadId, next);
    setStates(statesRef.current);
  }, []);

  const apply = useCallback(
    (threadId: string, action: AgentShipAction): void =>
      publish(threadId, agentShipReducer(currentState(threadId), action)),
    [currentState, publish],
  );

  const epochOf = useCallback((threadId: string): object => {
    const known = epochRef.current.get(threadId);
    if (known !== undefined) return known;
    const fresh = {};
    epochRef.current.set(threadId, fresh);
    return fresh;
  }, []);

  const owner = useCallback(
    (threadId: string): Owner | null => {
      const deps = dependenciesRef.current;
      const target = deps.resolve(threadId);
      if (deps.port === null || target === null) return null;
      return { target, port: deps.port, epoch: epochOf(threadId) };
    },
    [epochOf],
  );

  const owns = useCallback((captured: Owner): boolean => {
    const deps = dependenciesRef.current;
    return (
      mountedRef.current &&
      deps.port === captured.port &&
      epochRef.current.get(captured.target.threadId) === captured.epoch &&
      sameRemoteShipTarget(deps.resolve(captured.target.threadId), captured.target)
    );
  }, []);

  const settledTarget = useCallback((captured: Owner): RemoteShipTarget => {
    const current = dependenciesRef.current.resolve(captured.target.threadId);
    return {
      ...captured.target,
      repositoryKey: current?.repositoryKey ?? captured.target.repositoryKey,
    };
  }, []);

  const rememberGit = useCallback(
    (captured: Owner, status: RemoteThreadGitStatus): GitShipStatus => {
      const threadId = captured.target.threadId;
      gitStatusesRef.current = new Map(gitStatusesRef.current).set(threadId, status);
      if (mountedRef.current) setGitStatuses(gitStatusesRef.current);
      return remoteShipStatus(settledTarget(captured), status);
    },
    [settledTarget],
  );

  const dropEntries = useCallback((threadIds: readonly string[]): void => {
    const states = new Map(statesRef.current);
    const statuses = new Map(gitStatusesRef.current);
    for (const threadId of threadIds) {
      states.delete(threadId);
      statuses.delete(threadId);
    }
    if (states.size !== statesRef.current.size) {
      statesRef.current = states;
      if (mountedRef.current) setStates(states);
    }
    if (statuses.size !== gitStatusesRef.current.size) {
      gitStatusesRef.current = statuses;
      if (mountedRef.current) setGitStatuses(statuses);
    }
  }, []);

  const clear = useCallback(
    (threadId: string): void => {
      epochRef.current.set(threadId, {});
      refreshRef.current.delete(threadId);
      abortsRef.current.get(threadId)?.abort();
      abortsRef.current.delete(threadId);
      dropEntries([threadId]);
    },
    [dropEntries],
  );

  const retain = useCallback(
    (present: RemoteShipThreadPresence): void => {
      const known = new Set([
        ...epochRef.current.keys(),
        ...refreshRef.current.keys(),
        ...statesRef.current.keys(),
        ...gitStatusesRef.current.keys(),
      ]);
      const absent = [...known].filter((threadId) => !present.has(threadId));
      if (absent.length === 0) return;
      for (const threadId of absent) {
        epochRef.current.delete(threadId);
        refreshRef.current.delete(threadId);
        abortsRef.current.get(threadId)?.abort();
        abortsRef.current.delete(threadId);
      }
      dropEntries(absent);
    },
    [dropEntries],
  );

  const refreshShipStatus = useCallback(
    async (threadId: string): Promise<void> => {
      const captured = owner(threadId);
      if (captured === null) return;
      const generation = (refreshRef.current.get(threadId) ?? 0) + 1;
      refreshRef.current.set(threadId, generation);
      if (currentState(threadId).kind === "idle") apply(threadId, { kind: "statusRequested" });
      const loaded = await attempt(() =>
        captured.port.threadStatus(remoteShipThreadKey(captured.target)),
      );
      if (refreshRef.current.get(threadId) !== generation || !owns(captured)) return;
      if (loaded.ok) {
        const status = rememberGit(captured, loaded.value);
        publish(threadId, remoteShipStatusLoaded(currentState(threadId), status));
        return;
      }
      dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, loaded.error);
      apply(threadId, { kind: "statusFailed", message: errorMessageOf(loaded.error) });
    },
    [apply, currentState, owner, owns, publish, rememberGit],
  );

  const invalidateRefresh = useCallback((threadId: string): void => {
    refreshRef.current.set(threadId, (refreshRef.current.get(threadId) ?? 0) + 1);
  }, []);

  const settledWithoutOwner = useCallback(
    (captured: Owner): AgentShipStepResult => {
      const threadId = captured.target.threadId;
      if (epochRef.current.get(threadId) === captured.epoch) clear(threadId);
      return STEP_SUCCEEDED;
    },
    [clear],
  );

  const stepFailed = useCallback(
    (threadId: string, failed: AgentShipFailure): AgentShipStepResult => {
      apply(threadId, { kind: "stepFailed", failure: failed });
      return { kind: "failed", failure: failed };
    },
    [apply],
  );

  const authorityLost = useCallback(
    (captured: Owner, step: "commit" | "push"): AgentShipStepResult => {
      const lost: AgentShipFailure = { step, reason: "authorityLost" };
      const threadId = captured.target.threadId;
      if (epochRef.current.get(threadId) !== captured.epoch) {
        return { kind: "failed", failure: lost };
      }
      return stepFailed(threadId, lost);
    },
    [stepFailed],
  );

  const runStep = useCallback(
    async (
      threadId: string,
      step: "commit" | "push",
      operation: (captured: Owner, begin: () => void) => Promise<AgentShipStepResult>,
    ): Promise<AgentShipStepResult> => {
      if (inFlightRef.current.has(threadId)) return notRun(REMOTE_SHIP_STEP_IN_FLIGHT_MESSAGE);
      const captured = owner(threadId);
      if (captured === null) return notRun("This thread cannot ship changes right now.");
      if (captured.target.running) {
        dependenciesRef.current.setNotice(warning(REMOTE_SHIP_STOP_AGENT_MESSAGE));
        return notRun(REMOTE_SHIP_STOP_AGENT_MESSAGE);
      }
      inFlightRef.current.add(threadId);
      let started = false;
      let uncertain = false;
      const invalidateOwnedRefresh = () => {
        if (epochRef.current.get(threadId) === captured.epoch) invalidateRefresh(threadId);
      };
      const begin = () => {
        started = true;
        invalidateOwnedRefresh();
      };
      try {
        return await operation(captured, begin);
      } catch (error) {
        if (!owns(captured)) return authorityLost(captured, step);
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        uncertain = true;
        return stepFailed(threadId, remoteStepFailure(step, errorMessageOf(error)));
      } finally {
        inFlightRef.current.delete(threadId);
        if (started) invalidateOwnedRefresh();
        if (uncertain) void refreshShipStatus(threadId);
      }
    },
    [authorityLost, invalidateRefresh, owner, owns, refreshShipStatus, stepFailed],
  );

  const commit = useCallback(
    (threadId: string, message: string): Promise<AgentShipStepResult> =>
      runStep(threadId, "commit", async (captured, begin) => {
        const bounded = remoteCommitMessage(message);
        if (bounded === null) {
          dependenciesRef.current.setNotice(warning(REMOTE_SHIP_COMMIT_MESSAGE_INVALID));
          return notRun(REMOTE_SHIP_COMMIT_MESSAGE_INVALID);
        }
        const started: AgentShipAction = { kind: "commitStarted", message: bounded };
        if (!agentShipTransitionAllowed(currentState(threadId), started)) {
          return notRun(REMOTE_SHIP_STEP_IN_FLIGHT_MESSAGE);
        }
        apply(threadId, started);
        begin();
        const admission = await captured.port.commit(remoteShipThreadKey(captured.target), bounded);
        if (!owns(captured)) {
          return admission.kind === "accepted"
            ? settledWithoutOwner(captured)
            : authorityLost(captured, "commit");
        }
        if (admission.kind === "refused") {
          return stepFailed(threadId, remoteCommitFailure(admission.error));
        }
        const status = rememberGit(captured, admission.value.status);
        apply(threadId, {
          kind: "commitSucceeded",
          commitSha: admission.value.commitSha,
          status,
        });
        dependenciesRef.current.onShipStepCompleted?.(threadId);
        return STEP_SUCCEEDED;
      }),
    [
      apply,
      authorityLost,
      currentState,
      owns,
      rememberGit,
      runStep,
      settledWithoutOwner,
      stepFailed,
    ],
  );

  const push = useCallback(
    (threadId: string, pushTarget: RemoteGitPushTarget = "thread-branch") =>
      runStep(threadId, "push", async (captured, begin) => {
        if (!agentShipTransitionAllowed(currentState(threadId), { kind: "pushStarted" })) {
          return notRun(REMOTE_SHIP_STEP_IN_FLIGHT_MESSAGE);
        }
        apply(threadId, { kind: "pushStarted" });
        begin();
        const key = remoteShipThreadKey(captured.target);
        const admission = await captured.port.push(key, crypto.randomUUID(), pushTarget);
        if (!owns(captured)) return authorityLost(captured, "push");
        if (admission.kind === "refused") {
          return stepFailed(threadId, remotePushFailure(admission.error));
        }
        const controller = new AbortController();
        abortsRef.current.set(threadId, controller);
        const outcome = await captured.port
          .awaitOperation(key, admission.value, controller.signal)
          .finally(() => {
            if (abortsRef.current.get(threadId) === controller) abortsRef.current.delete(threadId);
          });
        const ownerLost = (): AgentShipStepResult =>
          outcome.kind === "succeeded"
            ? settledWithoutOwner(captured)
            : authorityLost(captured, "push");
        if (!owns(captured)) return ownerLost();
        const loaded = await attempt(() => captured.port.threadStatus(key));
        if (!owns(captured)) return ownerLost();
        const git = loaded.ok ? loaded.value : (gitStatusesRef.current.get(threadId) ?? null);
        const shipStatus = loaded.ok
          ? rememberGit(captured, loaded.value)
          : agentShipStatus(currentState(threadId));
        const settlement = remotePushSettlement(outcome, settledTarget(captured), git, pushTarget);
        if (settlement.kind === "failed") {
          apply(threadId, { kind: "stepFailed", failure: settlement.failure });
          if (shipStatus !== null) {
            publish(threadId, remoteShipStatusLoaded(currentState(threadId), shipStatus));
          }
          return { kind: "failed", failure: settlement.failure };
        }
        dependenciesRef.current.onShipStepCompleted?.(threadId);
        if (shipStatus === null) {
          apply(threadId, {
            kind: "stepFailed",
            failure: remoteStepFailure("push", REMOTE_SHIP_PUSH_STATUS_UNAVAILABLE),
          });
          return STEP_SUCCEEDED;
        }
        apply(threadId, { kind: "pushSucceeded", receipt: settlement.receipt, status: shipStatus });
        return STEP_SUCCEEDED;
      }),
    [
      apply,
      authorityLost,
      currentState,
      owns,
      publish,
      rememberGit,
      runStep,
      settledTarget,
      settledWithoutOwner,
      stepFailed,
    ],
  );

  const openCompareUrl = useCallback(
    async (threadId: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const state = currentState(threadId);
      if (state.kind !== "pushed") return;
      const url = state.receipt.compareUrl ?? state.status?.remote?.compareUrl ?? null;
      if (url === null) {
        deps.setNotice(
          info(`Pushed ${state.receipt.branch}. Open a pull request on your hosting site.`),
        );
        return;
      }
      const opener = deps.externalUrlOpener;
      if (opener === null) {
        deps.setNotice(info(`Open the compare page: ${url}`));
        return;
      }
      const opened = await attempt(() => opener.openExternal(url));
      if (!mountedRef.current || opened.ok) return;
      deps.reportError(AGENT_TASKS_SOURCE, opened.error);
      deps.setNotice(failure(`The compare page could not be opened: ${url}`));
    },
    [currentState],
  );

  const resetShip = useCallback(
    (threadId: string): void => apply(threadId, { kind: "reset" }),
    [apply],
  );

  return {
    states,
    gitStatuses,
    refreshShipStatus,
    commit,
    push,
    openCompareUrl,
    resetShip,
    clear,
    retain,
  };
}
