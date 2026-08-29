import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AgentProviderSignInGateway,
  AgentProviderSignInResult,
  AgentProviderSignInState,
  AgentProviderSignInTerminalSize,
} from "../domain/agentProviderSignIn";
import type { AgentCliKind } from "../domain/agentTask";
import type {
  AgentProviderAdmissionAuthority,
  AgentProviderAdmissionAuthorityReader,
  ReadyAgentProviderAdmissionAuthority,
} from "./agentProviderAdmissionAuthority";
import { isCurrentAgentProviderAdmissionAuthority } from "./agentProviderAdmissionAuthority";

export interface AgentProviderSignInTerminalIntent {
  readonly intentId: number;
  readonly provider: AgentCliKind;
  readonly providerGeneration: number;
  readonly revision: number;
}

export interface AgentProviderSignInDependencies {
  readonly gateway: AgentProviderSignInGateway;
  readonly readAuthority: AgentProviderAdmissionAuthorityReader;
  readonly liveTurnCount: (provider: AgentCliKind) => number;
  readonly terminalUnavailableReason: () => string | null;
  readonly revealTerminal: () => void;
  readonly stopSession: (sessionId: number) => Promise<void>;
  readonly refresh: (
    provider: AgentCliKind,
    authority: ReadyAgentProviderAdmissionAuthority,
  ) => Promise<AgentProviderSignInRefreshOutcome>;
}

export type AgentProviderSignInRefreshOutcome =
  | { readonly kind: "complete"; readonly authority: ReadyAgentProviderAdmissionAuthority }
  | { readonly kind: "failed" }
  | { readonly kind: "stale" };

export interface AgentProviderSignInSurface {
  readonly states: Readonly<Record<AgentCliKind, AgentProviderSignInState>>;
  readonly terminalIntents: Readonly<
    Record<AgentCliKind, AgentProviderSignInTerminalIntent | null>
  >;
  blockedReason(provider: AgentCliKind): string | null;
  isActive(provider: AgentCliKind): boolean;
  request(provider: AgentCliKind): boolean;
  cancelStart(intent: AgentProviderSignInTerminalIntent): void;
  start(
    intent: AgentProviderSignInTerminalIntent,
    size: AgentProviderSignInTerminalSize,
  ): Promise<AgentProviderSignInResult | null>;
  settle(
    intent: AgentProviderSignInTerminalIntent,
    sessionId: number,
    exitCode: number | null,
  ): Promise<void>;
}

interface RunningSignInOwnership {
  readonly intent: AgentProviderSignInTerminalIntent;
  readonly sessionId: number;
  readonly stopSession: (sessionId: number) => Promise<void>;
}

const idleStates = (): Record<AgentCliKind, AgentProviderSignInState> => ({
  claudeCode: { kind: "idle" },
  codex: { kind: "idle" },
});

const emptyIntents = (): Record<AgentCliKind, AgentProviderSignInTerminalIntent | null> => ({
  claudeCode: null,
  codex: null,
});

export function useAgentProviderSignIn(
  dependencies: AgentProviderSignInDependencies,
): AgentProviderSignInSurface {
  const [states, setStates] = useState(idleStates);
  const [terminalIntents, setTerminalIntents] = useState(emptyIntents);
  const dependenciesRef = useRef(dependencies);
  const statesRef = useRef(states);
  const intentsRef = useRef(terminalIntents);
  const sequenceRef = useRef(0);
  const startedIntentIdsRef = useRef(new Set<number>());
  const runningOwnershipRef = useRef<Partial<Record<AgentCliKind, RunningSignInOwnership>>>({});
  const preparedAuthorityRef = useRef<
    Partial<Record<AgentCliKind, ReadyAgentProviderAdmissionAuthority>>
  >({});
  const cleanupInFlightRef = useRef(new Set<RunningSignInOwnership>());
  const mountedRef = useRef(true);
  const gatewayOwnerRef = useRef(dependencies.gateway);

  useEffect(() => {
    const cleanupInFlight = cleanupInFlightRef.current;
    const startedIntentIds = startedIntentIdsRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const ownership of Object.values(runningOwnershipRef.current)) {
        if (ownership === undefined || cleanupInFlight.has(ownership)) continue;
        cleanupInFlight.add(ownership);
        void ownership
          .stopSession(ownership.sessionId)
          .catch(() => undefined)
          .finally(() => cleanupInFlight.delete(ownership));
      }
      runningOwnershipRef.current = {};
      preparedAuthorityRef.current = {};
      startedIntentIds.clear();
    };
  }, []);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
    statesRef.current = states;
    intentsRef.current = terminalIntents;
  });

  const publishState = useCallback((provider: AgentCliKind, state: AgentProviderSignInState) => {
    if (!mountedRef.current) return;
    const next = { ...statesRef.current, [provider]: state };
    statesRef.current = next;
    setStates(next);
  }, []);

  const publishIntent = useCallback(
    (provider: AgentCliKind, intent: AgentProviderSignInTerminalIntent | null) => {
      if (!mountedRef.current) return;
      if (intent === null) delete preparedAuthorityRef.current[provider];
      const next = { ...intentsRef.current, [provider]: intent };
      intentsRef.current = next;
      setTerminalIntents(next);
    },
    [],
  );

  const settleReplacementCleanup = useCallback(
    async (provider: AgentCliKind, ownership: RunningSignInOwnership): Promise<void> => {
      if (cleanupInFlightRef.current.has(ownership)) return;
      cleanupInFlightRef.current.add(ownership);
      let uncertain = false;
      try {
        await ownership.stopSession(ownership.sessionId);
      } catch {
        uncertain = true;
      }
      cleanupInFlightRef.current.delete(ownership);
      if (runningOwnershipRef.current[provider] !== ownership) return;
      delete runningOwnershipRef.current[provider];
      startedIntentIdsRef.current.delete(ownership.intent.intentId);
      if (!mountedRef.current) return;
      publishIntent(provider, null);
      publishState(
        provider,
        uncertain
          ? { kind: "failed", ...intentAuthority(ownership.intent), reason: "uncertain" }
          : { kind: "idle" },
      );
    },
    [publishIntent, publishState],
  );

  useEffect(() => {
    if (gatewayOwnerRef.current === dependencies.gateway) return;
    gatewayOwnerRef.current = dependencies.gateway;
    for (const provider of ["claudeCode", "codex"] as const) {
      const ownership = runningOwnershipRef.current[provider];
      if (ownership === undefined) {
        const intent = intentsRef.current[provider];
        if (intent !== null) startedIntentIdsRef.current.delete(intent.intentId);
        publishIntent(provider, null);
        publishState(provider, { kind: "idle" });
        continue;
      }
      void settleReplacementCleanup(provider, ownership);
    }
  }, [dependencies.gateway, publishIntent, publishState, settleReplacementCleanup]);

  const blockedReason = useCallback((provider: AgentCliKind): string | null => {
    const unavailable = dependenciesRef.current.terminalUnavailableReason();
    if (unavailable !== null) return unavailable;
    const authority = dependenciesRef.current.readAuthority(provider);
    const authorityReason = authorityBlockedReason(authority);
    if (authorityReason !== null) return authorityReason;
    if (dependenciesRef.current.liveTurnCount(provider) > 0) {
      return `Stop running ${providerLabel(provider)} turns before signing in.`;
    }
    const state = statesRef.current[provider];
    if (state.kind === "starting" || state.kind === "running") {
      return `${providerLabel(provider)} sign-in is already running.`;
    }
    return null;
  }, []);

  const isActive = useCallback((provider: AgentCliKind): boolean => {
    const state = statesRef.current[provider];
    return state.kind === "starting" || state.kind === "running";
  }, []);

  const request = useCallback(
    (provider: AgentCliKind): boolean => {
      if (blockedReason(provider) !== null) return false;
      const authority = dependenciesRef.current.readAuthority(provider);
      if (!readyAuthority(authority)) return false;
      const intentId = nextAgentProviderSignInIntentId(
        sequenceRef.current,
        hasLiveIntent(intentsRef.current, runningOwnershipRef.current),
      );
      if (intentId === null) return false;
      sequenceRef.current = intentId;
      const intent = {
        intentId,
        provider,
        providerGeneration: authority.providerGeneration,
        revision: authority.revision,
      };
      preparedAuthorityRef.current[provider] = {
        provider: authority.provider,
        revision: authority.revision,
        disposition: { kind: "ready" },
        providerGeneration: authority.providerGeneration,
      };
      publishState(provider, { kind: "starting", ...intentAuthority(intent) });
      publishIntent(provider, intent);
      dependenciesRef.current.revealTerminal();
      return true;
    },
    [blockedReason, publishIntent, publishState],
  );

  const start = useCallback(
    async (
      intent: AgentProviderSignInTerminalIntent,
      size: AgentProviderSignInTerminalSize,
    ): Promise<AgentProviderSignInResult | null> => {
      const authority = preparedAuthorityForIntent(preparedAuthorityRef.current, intent);
      if (authority === null || !intentIsCurrent(intentsRef.current, intent)) return null;
      if (startedIntentIdsRef.current.has(intent.intentId)) return null;
      if (
        startBlockedReason(dependenciesRef.current, statesRef.current, intent, authority) !== null
      ) {
        publishIntent(intent.provider, null);
        publishState(intent.provider, { kind: "idle" });
        return null;
      }
      startedIntentIdsRef.current.add(intent.intentId);
      const gateway = dependenciesRef.current.gateway;
      const stopSession = dependenciesRef.current.stopSession;
      let result: AgentProviderSignInResult;
      try {
        result = await gateway.startAgentProviderSignIn({
          provider: intent.provider,
          providerGeneration: intent.providerGeneration,
          size,
        });
      } catch {
        startedIntentIdsRef.current.delete(intent.intentId);
        if (!mountedRef.current) return null;
        if (
          dependenciesRef.current.gateway === gateway &&
          intentIsCurrent(intentsRef.current, intent) &&
          authorityIsCurrent(dependenciesRef.current.readAuthority, authority, intent)
        ) {
          publishState(intent.provider, {
            kind: "failed",
            ...intentAuthority(intent),
            reason: "uncertain",
          });
          publishIntent(intent.provider, null);
        }
        return null;
      }
      if (
        !mountedRef.current ||
        dependenciesRef.current.gateway !== gateway ||
        !authorityIsCurrent(dependenciesRef.current.readAuthority, authority, intent) ||
        !intentIsCurrent(intentsRef.current, intent)
      ) {
        let compensationFailed = false;
        if (result.kind === "started") {
          try {
            await stopSession(result.sessionId);
          } catch {
            compensationFailed = true;
          }
        }
        startedIntentIdsRef.current.delete(intent.intentId);
        if (mountedRef.current && intentIsCurrent(intentsRef.current, intent)) {
          publishIntent(intent.provider, null);
          publishState(
            intent.provider,
            compensationFailed
              ? {
                  kind: "failed",
                  ...intentAuthority(intent),
                  reason: "uncertain",
                }
              : { kind: "idle" },
          );
        }
        return null;
      }
      if (result.kind === "refused") {
        startedIntentIdsRef.current.delete(intent.intentId);
        publishState(intent.provider, {
          kind: "failed",
          ...intentAuthority(intent),
          reason: result.reason,
        });
        publishIntent(intent.provider, null);
        return result;
      }
      runningOwnershipRef.current[intent.provider] = {
        intent,
        sessionId: result.sessionId,
        stopSession,
      };
      publishState(intent.provider, {
        kind: "running",
        ...intentAuthority(intent),
        sessionId: result.sessionId,
      });
      return result;
    },
    [publishIntent, publishState],
  );

  const cancelStart = useCallback(
    (intent: AgentProviderSignInTerminalIntent): void => {
      const state = statesRef.current[intent.provider];
      if (
        state.kind !== "starting" ||
        state.providerGeneration !== intent.providerGeneration ||
        !intentIsCurrent(intentsRef.current, intent)
      ) {
        return;
      }
      startedIntentIdsRef.current.delete(intent.intentId);
      publishIntent(intent.provider, null);
      publishState(intent.provider, {
        kind: "failed",
        ...intentAuthority(intent),
        reason: "spawnFailed",
      });
    },
    [publishIntent, publishState],
  );

  const settle = useCallback(
    async (
      intent: AgentProviderSignInTerminalIntent,
      sessionId: number,
      exitCode: number | null,
    ): Promise<void> => {
      const state = statesRef.current[intent.provider];
      if (
        state.kind !== "running" ||
        state.sessionId !== sessionId ||
        !intentIsCurrent(intentsRef.current, intent)
      ) {
        return;
      }
      startedIntentIdsRef.current.delete(intent.intentId);
      const ownership = runningOwnershipRef.current[intent.provider];
      if (
        ownership !== undefined &&
        ownership.sessionId === sessionId &&
        intentIsSame(ownership.intent, intent)
      ) {
        delete runningOwnershipRef.current[intent.provider];
        cleanupInFlightRef.current.delete(ownership);
      }
      const authority = preparedAuthorityForIntent(preparedAuthorityRef.current, intent);
      publishIntent(intent.provider, null);
      if (
        authority === null ||
        !authorityIsCurrent(dependenciesRef.current.readAuthority, authority, intent)
      ) {
        publishState(intent.provider, { kind: "idle" });
        return;
      }
      publishState(intent.provider, {
        kind: "settled",
        ...intentAuthority(intent),
        sessionId,
        exitCode,
        healthRefresh: "refreshing",
      });
      let refreshOutcome: AgentProviderSignInRefreshOutcome = { kind: "failed" };
      try {
        refreshOutcome = await dependenciesRef.current.refresh(intent.provider, authority);
      } catch {
        refreshOutcome = { kind: "failed" };
      }
      const current = statesRef.current[intent.provider];
      if (
        current.kind !== "settled" ||
        current.sessionId !== sessionId ||
        current.providerGeneration !== intent.providerGeneration ||
        current.healthRefresh !== "refreshing"
      ) {
        return;
      }
      if (
        refreshOutcome.kind === "stale" ||
        !settledAuthorityIsCurrent(
          dependenciesRef.current.readAuthority,
          authority,
          intent,
          refreshOutcome,
        )
      ) {
        publishState(intent.provider, { kind: "idle" });
        return;
      }
      publishState(intent.provider, { ...current, healthRefresh: refreshOutcome.kind });
    },
    [publishIntent, publishState],
  );

  return useMemo(
    () => ({
      states,
      terminalIntents,
      blockedReason,
      isActive,
      request,
      cancelStart,
      start,
      settle,
    }),
    [blockedReason, cancelStart, isActive, request, settle, start, states, terminalIntents],
  );
}

export function nextAgentProviderSignInIntentId(
  current: number,
  hasLiveIntent: boolean,
): number | null {
  if (!Number.isSafeInteger(current) || current < 0 || current > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  if (current < Number.MAX_SAFE_INTEGER) return current + 1;
  return hasLiveIntent ? null : 1;
}

function hasLiveIntent(
  intents: Readonly<Record<AgentCliKind, AgentProviderSignInTerminalIntent | null>>,
  ownership: Partial<Record<AgentCliKind, RunningSignInOwnership>>,
): boolean {
  return (
    intents.claudeCode !== null ||
    intents.codex !== null ||
    ownership.claudeCode !== undefined ||
    ownership.codex !== undefined
  );
}

function authorityBlockedReason(authority: AgentProviderAdmissionAuthority): string | null {
  const label = providerLabel(authority.provider);
  switch (authority.disposition.kind) {
    case "ready":
      if (!readyAuthority(authority))
        return `Install ${label} or configure a valid manual CLI path before signing in.`;
      return null;
    case "disabled":
      return `Enable ${label} before signing in.`;
    case "updating":
      return `Wait for the ${label} update to finish before signing in.`;
    case "policyUnavailable":
      if (authority.disposition.reason === "notConfigured") {
        return `Install ${label} or configure a valid manual CLI path before signing in.`;
      }
      if (authority.disposition.reason === "unregistered") {
        return `Register ${label} provider settings before signing in.`;
      }
      return `Retry ${label} provider registration before signing in.`;
    default:
      return unsupportedAuthority(authority.disposition);
  }
}

function readyAuthority(
  authority: AgentProviderAdmissionAuthority,
): authority is ReadyAgentProviderAdmissionAuthority {
  return authority.disposition.kind === "ready" && "providerGeneration" in authority;
}

function preparedAuthorityForIntent(
  prepared: Partial<Record<AgentCliKind, ReadyAgentProviderAdmissionAuthority>>,
  intent: AgentProviderSignInTerminalIntent,
): ReadyAgentProviderAdmissionAuthority | null {
  const authority = prepared[intent.provider];
  if (authority === undefined) return null;
  if (authority.provider !== intent.provider) return null;
  if (authority.revision !== intent.revision) return null;
  if (authority.providerGeneration !== intent.providerGeneration) return null;
  return authority;
}

function authorityIsCurrent(
  read: AgentProviderAdmissionAuthorityReader,
  authority: ReadyAgentProviderAdmissionAuthority,
  intent: AgentProviderSignInTerminalIntent,
): boolean {
  return (
    intent.revision === authority.revision &&
    isCurrentAgentProviderAdmissionAuthority(read, authority)
  );
}

function settledAuthorityIsCurrent(
  read: AgentProviderAdmissionAuthorityReader,
  captured: ReadyAgentProviderAdmissionAuthority,
  intent: AgentProviderSignInTerminalIntent,
  refreshOutcome: Exclude<AgentProviderSignInRefreshOutcome, { readonly kind: "stale" }>,
): boolean {
  if (refreshOutcome.kind === "failed") return authorityIsCurrent(read, captured, intent);
  if (refreshOutcome.authority.provider !== intent.provider) return false;
  if (refreshOutcome.authority.providerGeneration !== intent.providerGeneration) return false;
  return isCurrentAgentProviderAdmissionAuthority(read, refreshOutcome.authority);
}

function intentIsCurrent(
  intents: Readonly<Record<AgentCliKind, AgentProviderSignInTerminalIntent | null>>,
  intent: AgentProviderSignInTerminalIntent,
): boolean {
  const current = intents[intent.provider];
  return current !== null && intentIsSame(current, intent);
}

function intentIsSame(
  current: AgentProviderSignInTerminalIntent,
  candidate: AgentProviderSignInTerminalIntent,
): boolean {
  return (
    current.intentId === candidate.intentId &&
    current.provider === candidate.provider &&
    current.revision === candidate.revision &&
    current.providerGeneration === candidate.providerGeneration
  );
}

function intentAuthority(intent: AgentProviderSignInTerminalIntent) {
  return {
    provider: intent.provider,
    providerGeneration: intent.providerGeneration,
  } as const;
}

function startBlockedReason(
  dependencies: AgentProviderSignInDependencies,
  states: Readonly<Record<AgentCliKind, AgentProviderSignInState>>,
  intent: AgentProviderSignInTerminalIntent,
  authority: ReadyAgentProviderAdmissionAuthority,
): string | null {
  const unavailable = dependencies.terminalUnavailableReason();
  if (unavailable !== null) return unavailable;
  const currentAuthority = dependencies.readAuthority(intent.provider);
  if (!authorityIsCurrent(dependencies.readAuthority, authority, intent)) {
    return authorityBlockedReason(currentAuthority) ?? "Provider sign-in authority changed.";
  }
  if (dependencies.liveTurnCount(intent.provider) > 0) {
    return `Stop running ${providerLabel(intent.provider)} turns before signing in.`;
  }
  const state = states[intent.provider];
  if (
    state.kind !== "starting" ||
    state.provider !== intent.provider ||
    state.providerGeneration !== intent.providerGeneration
  ) {
    return `${providerLabel(intent.provider)} sign-in is already running.`;
  }
  return null;
}

function providerLabel(provider: AgentCliKind): string {
  if (provider === "claudeCode") return "Claude Code";
  if (provider === "codex") return "Codex";
  return unsupportedProvider(provider);
}

function unsupportedAuthority(disposition: never): never {
  throw new TypeError(`Unsupported sign-in authority: ${String(disposition)}.`);
}

function unsupportedProvider(provider: never): never {
  throw new TypeError(`Unsupported sign-in provider: ${String(provider)}.`);
}
