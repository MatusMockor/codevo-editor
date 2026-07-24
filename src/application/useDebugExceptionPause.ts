import { useCallback, useEffect, useRef, useState } from "react";
import type { DebugExceptionPauseMode, DebugGateway, DebugLaunchTarget } from "../domain/debug";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";

interface SessionAdapter {
  readonly kind: Exclude<ActiveDebugAdapterKind, null>;
  readonly sessionId: number;
}

interface Options {
  readonly activeSessionId: () => number | null;
  readonly gateway: DebugGateway;
  readonly setExceptionPauseForSession?: (
    rootPath: string,
    sessionId: number,
    mode: DebugExceptionPauseMode,
  ) => Promise<void>;
  readonly workspaceRoot: string | null;
}

export function useDebugExceptionPause({
  activeSessionId,
  gateway,
  setExceptionPauseForSession,
  workspaceRoot,
}: Options) {
  const [modes, setModes] = useState<Record<string, DebugExceptionPauseMode>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [sessionAdapters, setSessionAdapters] = useState<Record<string, SessionAdapter>>({});
  const modesRef = useRef(modes);
  modesRef.current = modes;
  const adaptersRef = useRef(sessionAdapters);
  adaptersRef.current = sessionAdapters;
  const currentRootRef = useRef(workspaceRoot);
  currentRootRef.current = workspaceRoot;
  const previousRootRef = useRef(workspaceRoot);
  const sequencesRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => void (mountedRef.current = false);
  }, []);
  useEffect(() => {
    const previousRoot = previousRootRef.current;
    previousRootRef.current = workspaceRoot;
    if (!previousRoot || workspaceRootKeysEqual(previousRoot, workspaceRoot)) return;
    const key = normalizedWorkspaceRootKey(previousRoot);
    sequencesRef.current.set(key, (sequencesRef.current.get(key) ?? 0) + 1);
  }, [workspaceRoot]);

  const startPolicyForAdapter = useCallback(
    (rootPath: string, adapterKind: Exclude<ActiveDebugAdapterKind, null>) => {
      const key = normalizedWorkspaceRootKey(rootPath);
      return {
        adapterKind,
        mode: adapterKind === "node" ? (modesRef.current[key] ?? "none") : ("none" as const),
      };
    },
    [],
  );
  const startPolicy = useCallback(
    (rootPath: string, launch: DebugLaunchTarget) =>
      startPolicyForAdapter(rootPath, debugAdapterKindForLaunch(launch)),
    [startPolicyForAdapter],
  );

  const adoptSession = useCallback(
    (rootPath: string, sessionId: number, kind: Exclude<ActiveDebugAdapterKind, null>) => {
      const key = normalizedWorkspaceRootKey(rootPath);
      const next = { ...adaptersRef.current, [key]: { kind, sessionId } };
      adaptersRef.current = next;
      setSessionAdapters(next);
    },
    [],
  );

  const adapterKindForSession = useCallback((rootPath: string, sessionId: number) => {
    const adapter = adaptersRef.current[normalizedWorkspaceRootKey(rootPath)];
    return adapter?.sessionId === sessionId ? adapter.kind : null;
  }, []);

  const setExceptionPauseMode = useCallback(
    async (mode: DebugExceptionPauseMode) => {
      const rootPath = currentRootRef.current;
      if (!rootPath) return;
      const key = normalizedWorkspaceRootKey(rootPath);
      if (inFlightRef.current.has(key)) return;
      const nextModes = { ...modesRef.current, [key]: mode };
      modesRef.current = nextModes;
      setModes(nextModes);
      setErrors((current) => ({ ...current, [key]: null }));
      const sessionId = activeSessionId();
      const adapter = adaptersRef.current[key];
      if (!adapter || adapter.kind !== "node" || adapter.sessionId !== sessionId) return;

      const sequence = (sequencesRef.current.get(key) ?? 0) + 1;
      sequencesRef.current.set(key, sequence);
      inFlightRef.current.add(key);
      setPending((current) => ({ ...current, [key]: true }));
      const requestIsCurrent = () =>
        mountedRef.current &&
        sequencesRef.current.get(key) === sequence &&
        workspaceRootKeysEqual(rootPath, currentRootRef.current) &&
        activeSessionId() === sessionId &&
        adaptersRef.current[key]?.kind === "node" &&
        adaptersRef.current[key]?.sessionId === sessionId;
      try {
        await (setExceptionPauseForSession?.(rootPath, sessionId, mode) ??
          gateway.setExceptionPause(sessionId, mode));
      } catch (error) {
        if (requestIsCurrent()) {
          setErrors((current) => ({ ...current, [key]: errorMessage(error) }));
        }
      } finally {
        inFlightRef.current.delete(key);
        if (mountedRef.current) setPending((current) => ({ ...current, [key]: false }));
      }
    },
    [activeSessionId, gateway, setExceptionPauseForSession],
  );

  const key = normalizedWorkspaceRootKey(workspaceRoot);
  const state = sessionAdapters[key];
  const sessionId = activeSessionId();
  return {
    adapterKindForSession,
    adoptSession,
    debugAdapterKind: state?.sessionId === sessionId ? state.kind : null,
    exceptionPauseError: errors[key] ?? null,
    exceptionPauseMode: modes[key] ?? "none",
    exceptionPausePending: pending[key] ?? false,
    setExceptionPauseMode,
    startPolicy,
    startPolicyForAdapter,
  };
}

function debugAdapterKindForLaunch(
  launch: DebugLaunchTarget,
): Exclude<ActiveDebugAdapterKind, null> {
  return launch.kind.startsWith("php-") ? "php" : "node";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
