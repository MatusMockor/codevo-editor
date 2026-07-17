import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Breakpoint,
  DebugGateway,
  DebugLaunchTarget,
  DebugScope,
  DebugVariable,
  StepKind,
} from "../domain/debug";
import { debuggerSessionId } from "../domain/debug";
import {
  applyVerification,
  breakpointsForFile,
  removeBreakpoint as removeBreakpointFromList,
  sequentialBreakpointIdFactory,
  setBreakpointCondition as setBreakpointConditionInList,
  setBreakpointEnabled as setBreakpointEnabledInList,
  toggleBreakpoint as toggleBreakpointInList,
} from "../domain/debugBreakpoints";
import {
  initialDebuggerSnapshot,
  reduceDebuggerSnapshot,
  type DebuggerSessionSnapshot,
} from "../domain/debugSessionState";
import {
  normalizedWorkspaceRootKey,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";

const OUTPUT_LINE_CAP = 5000;
const OUTPUT_TRIM_THRESHOLD = 5500;

export interface DebugOutputLine {
  stream: "stdout" | "stderr";
  text: string;
}

export interface UseDebugSessionOptions {
  gateway: DebugGateway;
  workspaceRoot: string | null;
}

export interface UseDebugSessionResult {
  snapshot: DebuggerSessionSnapshot;
  breakpoints: Breakpoint[];
  output: DebugOutputLine[];
  lastStartError: string | null;
  selectedFrameId: number | null;
  scopes: DebugScope[];
  variablesByReference: Record<number, DebugVariable[]>;
  startDebug(launch: DebugLaunchTarget): Promise<void>;
  stopDebug(): Promise<void>;
  stepDebug(kind: StepKind): Promise<void>;
  pauseDebug(): Promise<void>;
  toggleBreakpoint(filePath: string, lineNumber: number): Promise<void>;
  setBreakpointEnabled(id: string, enabled: boolean): Promise<void>;
  setBreakpointCondition(id: string, condition: string | null): Promise<void>;
  removeBreakpoint(id: string): Promise<void>;
  selectFrame(frameId: number): Promise<void>;
  loadVariables(variablesReference: number): Promise<void>;
  evaluate(expression: string): Promise<DebugVariable | null>;
}

interface FrameSelection {
  frameId: number;
  scopes: DebugScope[];
}

const inactiveSnapshot = initialDebuggerSnapshot();
const emptyBreakpoints: Breakpoint[] = [];
const emptyOutput: DebugOutputLine[] = [];
const emptyVariables: Record<number, DebugVariable[]> = {};
const emptyScopes: DebugScope[] = [];

export function useDebugSession({
  gateway,
  workspaceRoot,
}: UseDebugSessionOptions): UseDebugSessionResult {
  const [snapshots, setSnapshots] = useState<
    Record<string, DebuggerSessionSnapshot>
  >({});
  const [breakpointsByRoot, setBreakpointsByRoot] = useState<
    Record<string, Breakpoint[]>
  >({});
  const [outputBySession, setOutputBySession] = useState<
    Record<number, DebugOutputLine[]>
  >({});
  const [startErrors, setStartErrors] = useState<Record<string, string>>({});
  const [frameSelectionByRoot, setFrameSelectionByRoot] = useState<
    Record<string, FrameSelection | null>
  >({});
  const [variablesByRoot, setVariablesByRoot] = useState<
    Record<string, Record<number, DebugVariable[]>>
  >({});

  const [createBreakpointId] = useState(() => sequentialBreakpointIdFactory());
  const currentRootRef = useRef(workspaceRoot);
  currentRootRef.current = workspaceRoot;
  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;
  const breakpointsByRootRef = useRef(breakpointsByRoot);
  const frameSelectionByRootRef = useRef(frameSelectionByRoot);
  frameSelectionByRootRef.current = frameSelectionByRoot;
  const mountedRef = useRef(true);
  const pendingStartKeysRef = useRef(new Set<string>());
  const pendingStopKeysRef = useRef(new Set<string>());
  const sessionsByRootRef = useRef<Record<string, number[]>>({});

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commitBreakpoints = useCallback(
    (key: string, list: Breakpoint[]) => {
      breakpointsByRootRef.current = {
        ...breakpointsByRootRef.current,
        [key]: list,
      };
      setBreakpointsByRoot(breakpointsByRootRef.current);
    },
    [],
  );

  const activeSessionId = useCallback((): number | null => {
    const root = currentRootRef.current;

    if (!root) {
      return null;
    }

    const snapshot =
      snapshotsRef.current[normalizedWorkspaceRootKey(root)] ??
      inactiveSnapshot;

    if (snapshot.state.kind === "terminated") {
      return null;
    }

    return debuggerSessionId(snapshot.state);
  }, []);

  useEffect(() => {
    const unsubscribe = gateway.subscribe((event) => {
      if (typeof event?.payload?.kind !== "string") {
        return;
      }

      const key = normalizedWorkspaceRootKey(event.rootPath);
      setSnapshots((current) => {
        const existing = current[key] ?? inactiveSnapshot;
        const next = reduceDebuggerSnapshot(existing, event);

        if (next === existing) {
          return current;
        }

        const updated = { ...current, [key]: next };
        snapshotsRef.current = updated;

        return updated;
      });

      const payload = event.payload;

      if (payload.kind === "output") {
        setOutputBySession((current) => {
          const appended = [
            ...(current[event.sessionId] ?? []),
            { stream: payload.stream, text: payload.text },
          ];
          const trimmed =
            appended.length > OUTPUT_TRIM_THRESHOLD
              ? appended.slice(-OUTPUT_LINE_CAP)
              : appended;

          return { ...current, [event.sessionId]: trimmed };
        });
        return;
      }

      if (payload.kind === "breakpointsVerified") {
        commitBreakpoints(
          key,
          applyVerification(
            breakpointsByRootRef.current[key] ?? [],
            payload.filePath,
            payload.breakpoints,
          ),
        );
        return;
      }

      if (
        payload.kind === "stopped" ||
        payload.kind === "resumed" ||
        payload.kind === "terminated"
      ) {
        setFrameSelectionByRoot((current) => ({ ...current, [key]: null }));
        setVariablesByRoot((current) => ({ ...current, [key]: {} }));
      }
    });

    return unsubscribe;
  }, [commitBreakpoints, gateway]);

  const startDebug = useCallback(
    async (launch: DebugLaunchTarget) => {
      const requestedRoot = currentRootRef.current;

      if (!requestedRoot) {
        return;
      }

      const key = normalizedWorkspaceRootKey(requestedRoot);

      if (pendingStartKeysRef.current.has(key)) {
        return;
      }

      pendingStartKeysRef.current.add(key);

      try {
        const status = await gateway.start(
          requestedRoot,
          launch,
          breakpointsByRootRef.current[key] ?? [],
        );
        const stale = !workspaceRootKeysEqual(
          requestedRoot,
          currentRootRef.current,
        );
        const stopRequested = pendingStopKeysRef.current.delete(key);

        if (status.kind !== "ok") {
          if (stale || !mountedRef.current) {
            return;
          }

          setStartErrors((current) => ({ ...current, [key]: status.message }));
          return;
        }

        if (stale || stopRequested || !mountedRef.current) {
          void gateway.stop(status.sessionId);
          return;
        }

        const existing = snapshotsRef.current[key] ?? inactiveSnapshot;
        const supersededSessionId =
          existing.state.kind === "terminated"
            ? null
            : debuggerSessionId(existing.state);

        if (
          supersededSessionId !== null &&
          supersededSessionId !== status.sessionId
        ) {
          void gateway.stop(supersededSessionId);
        }

        const previousSessions = sessionsByRootRef.current[key] ?? [];
        sessionsByRootRef.current = {
          ...sessionsByRootRef.current,
          [key]: [status.sessionId],
        };
        setStartErrors((current) => {
          const next = { ...current };
          delete next[key];

          return next;
        });
        setOutputBySession((current) => {
          const next = { ...current };

          for (const sessionId of previousSessions) {
            delete next[sessionId];
          }

          next[status.sessionId] = [];

          return next;
        });
        setFrameSelectionByRoot((current) => ({ ...current, [key]: null }));
        setVariablesByRoot((current) => ({ ...current, [key]: {} }));
        setSnapshots((current) => {
          const updated: Record<string, DebuggerSessionSnapshot> = {
            ...current,
            [key]: {
              state: { kind: "running", sessionId: status.sessionId },
              lastSeq: 0,
            },
          };
          snapshotsRef.current = updated;

          return updated;
        });
      } finally {
        pendingStartKeysRef.current.delete(key);
      }
    },
    [gateway],
  );

  const stopDebug = useCallback(async () => {
    const root = currentRootRef.current;

    if (!root) {
      return;
    }

    const sessionId = activeSessionId();

    if (sessionId !== null) {
      await gateway.stop(sessionId);
      return;
    }

    const key = normalizedWorkspaceRootKey(root);

    if (pendingStartKeysRef.current.has(key)) {
      pendingStopKeysRef.current.add(key);
    }
  }, [activeSessionId, gateway]);

  const stepDebug = useCallback(
    async (kind: StepKind) => {
      const sessionId = activeSessionId();

      if (sessionId === null) {
        return;
      }

      await gateway.step(sessionId, kind);
    },
    [activeSessionId, gateway],
  );

  const pauseDebug = useCallback(async () => {
    const sessionId = activeSessionId();

    if (sessionId === null) {
      return;
    }

    await gateway.pause(sessionId);
  }, [activeSessionId, gateway]);

  const syncBreakpointsForFile = useCallback(
    async (key: string, filePath: string, list: readonly Breakpoint[]) => {
      const sessionId = activeSessionId();

      if (sessionId === null) {
        return;
      }

      const verified = await gateway.setBreakpoints(
        sessionId,
        filePath,
        breakpointsForFile(list, filePath),
      );

      if (!mountedRef.current) {
        return;
      }

      commitBreakpoints(
        key,
        applyVerification(
          breakpointsByRootRef.current[key] ?? [],
          filePath,
          verified,
        ),
      );
    },
    [activeSessionId, commitBreakpoints, gateway],
  );

  const mutateBreakpoints = useCallback(
    async (
      filePathOf: (list: readonly Breakpoint[]) => string | null,
      mutate: (list: readonly Breakpoint[]) => Breakpoint[],
    ) => {
      const root = currentRootRef.current;

      if (!root) {
        return;
      }

      const key = normalizedWorkspaceRootKey(root);
      const current = breakpointsByRootRef.current[key] ?? [];
      const filePath = filePathOf(current);

      if (filePath === null) {
        return;
      }

      const next = mutate(current);
      commitBreakpoints(key, next);
      await syncBreakpointsForFile(key, filePath, next);
    },
    [commitBreakpoints, syncBreakpointsForFile],
  );

  const toggleBreakpoint = useCallback(
    (filePath: string, lineNumber: number) =>
      mutateBreakpoints(
        () => filePath,
        (list) =>
          toggleBreakpointInList(
            list,
            filePath,
            lineNumber,
            createBreakpointId,
          ),
      ),
    [createBreakpointId, mutateBreakpoints],
  );

  const filePathOfBreakpoint = useCallback(
    (id: string) => (list: readonly Breakpoint[]) =>
      list.find((entry) => entry.id === id)?.filePath ?? null,
    [],
  );

  const setBreakpointEnabled = useCallback(
    (id: string, enabled: boolean) =>
      mutateBreakpoints(filePathOfBreakpoint(id), (list) =>
        setBreakpointEnabledInList(list, id, enabled),
      ),
    [filePathOfBreakpoint, mutateBreakpoints],
  );

  const setBreakpointCondition = useCallback(
    (id: string, condition: string | null) =>
      mutateBreakpoints(filePathOfBreakpoint(id), (list) =>
        setBreakpointConditionInList(list, id, condition),
      ),
    [filePathOfBreakpoint, mutateBreakpoints],
  );

  const removeBreakpoint = useCallback(
    (id: string) =>
      mutateBreakpoints(filePathOfBreakpoint(id), (list) =>
        removeBreakpointFromList(list, id),
      ),
    [filePathOfBreakpoint, mutateBreakpoints],
  );

  const selectFrame = useCallback(
    async (frameId: number) => {
      const root = currentRootRef.current;
      const sessionId = activeSessionId();

      if (!root || sessionId === null) {
        return;
      }

      const key = normalizedWorkspaceRootKey(root);

      if ((snapshotsRef.current[key] ?? inactiveSnapshot).state.kind !== "stopped") {
        return;
      }

      const scopes = await gateway.scopes(sessionId, frameId);

      if (!mountedRef.current) {
        return;
      }

      if (!workspaceRootKeysEqual(root, currentRootRef.current)) {
        return;
      }

      if (activeSessionId() !== sessionId) {
        return;
      }

      setFrameSelectionByRoot((current) => ({
        ...current,
        [key]: { frameId, scopes },
      }));
    },
    [activeSessionId, gateway],
  );

  const loadVariables = useCallback(
    async (variablesReference: number) => {
      const root = currentRootRef.current;
      const sessionId = activeSessionId();

      if (!root || sessionId === null) {
        return;
      }

      const key = normalizedWorkspaceRootKey(root);

      if ((snapshotsRef.current[key] ?? inactiveSnapshot).state.kind !== "stopped") {
        return;
      }

      const variables = await gateway.variables(sessionId, variablesReference);

      if (!mountedRef.current) {
        return;
      }

      if (!workspaceRootKeysEqual(root, currentRootRef.current)) {
        return;
      }

      if (activeSessionId() !== sessionId) {
        return;
      }

      setVariablesByRoot((current) => ({
        ...current,
        [key]: { ...(current[key] ?? {}), [variablesReference]: variables },
      }));
    },
    [activeSessionId, gateway],
  );

  const evaluate = useCallback(
    async (expression: string): Promise<DebugVariable | null> => {
      const root = currentRootRef.current;
      const sessionId = activeSessionId();

      if (!root || sessionId === null) {
        return null;
      }

      const key = normalizedWorkspaceRootKey(root);
      const selection = frameSelectionByRootRef.current[key];
      const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
      const fallbackFrameId =
        state.kind === "stopped" ? state.topFrame?.frameId ?? null : null;
      const frameId = selection?.frameId ?? fallbackFrameId;

      if (frameId === null) {
        return null;
      }

      return gateway.evaluate(sessionId, frameId, expression);
    },
    [activeSessionId, gateway],
  );

  const activeKey = normalizedWorkspaceRootKey(workspaceRoot);
  const snapshot = snapshots[activeKey] ?? inactiveSnapshot;
  const sessionId = debuggerSessionId(snapshot.state);
  const selection = frameSelectionByRoot[activeKey] ?? null;

  return {
    snapshot,
    breakpoints: breakpointsByRoot[activeKey] ?? emptyBreakpoints,
    output:
      sessionId === null
        ? emptyOutput
        : outputBySession[sessionId] ?? emptyOutput,
    lastStartError: startErrors[activeKey] ?? null,
    selectedFrameId: selection?.frameId ?? null,
    scopes: selection?.scopes ?? emptyScopes,
    variablesByReference: variablesByRoot[activeKey] ?? emptyVariables,
    startDebug,
    stopDebug,
    stepDebug,
    pauseDebug,
    toggleBreakpoint,
    setBreakpointEnabled,
    setBreakpointCondition,
    removeBreakpoint,
    selectFrame,
    loadVariables,
    evaluate,
  };
}
