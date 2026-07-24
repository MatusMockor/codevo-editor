import { useCallback, useEffect, useRef, useState } from "react";
import type { JsTestCoverageGateway, JsTestCoverageReport } from "../domain/jsTestCoverage";

interface WorkspaceCoverageState {
  readonly error: string | null;
  readonly report: JsTestCoverageReport | null;
  readonly running: boolean;
  readonly unavailable: string | null;
}

export interface UseJsTestCoverageOptions {
  readonly gateway: JsTestCoverageGateway;
  readonly invalidationVersion: number;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}

export interface JsTestCoverageState {
  readonly error: string | null;
  readonly isRunning: boolean;
  readonly report: JsTestCoverageReport | null;
  readonly unavailable: string | null;
  clear(): void;
  run(): Promise<boolean>;
}

const EMPTY_STATE: WorkspaceCoverageState = {
  error: null,
  report: null,
  running: false,
  unavailable: null,
};

export function useJsTestCoverage({
  gateway,
  invalidationVersion,
  rootPath,
  workspaceId,
  workspaceTrusted,
}: UseJsTestCoverageOptions): JsTestCoverageState {
  const [states, setStates] = useState<Record<string, WorkspaceCoverageState>>({});
  const workspaceKey = workspaceId && rootPath ? `${workspaceId}\0${rootPath}` : null;
  const currentKeyRef = useRef(workspaceKey);
  currentKeyRef.current = workspaceKey;
  const trustedRef = useRef(workspaceTrusted);
  trustedRef.current = workspaceTrusted;
  const previousKeyRef = useRef(workspaceKey);
  const invalidationVersionsRef = useRef(new Map<string, number>());
  const sequencesRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(new Set<string>());
  const state = workspaceKey ? (states[workspaceKey] ?? EMPTY_STATE) : EMPTY_STATE;

  const run = useCallback(async (): Promise<boolean> => {
    const capturedKey = workspaceKey;
    const capturedRoot = rootPath;
    if (!capturedKey || !capturedRoot) return false;
    if (!workspaceTrusted) {
      setStates((current) => ({
        ...current,
        [capturedKey]: {
          ...(current[capturedKey] ?? EMPTY_STATE),
          unavailable: "Trust this workspace to run JavaScript test coverage.",
        },
      }));
      return false;
    }
    if (inFlightRef.current.has(capturedKey)) return false;
    inFlightRef.current.add(capturedKey);
    const sequence = (sequencesRef.current.get(capturedKey) ?? 0) + 1;
    sequencesRef.current.set(capturedKey, sequence);
    setStates((current) => ({
      ...current,
      [capturedKey]: {
        ...(current[capturedKey] ?? EMPTY_STATE),
        error: null,
        running: true,
        unavailable: null,
      },
    }));

    try {
      const response = await gateway.run(capturedRoot);
      if (
        currentKeyRef.current !== capturedKey ||
        !trustedRef.current ||
        sequencesRef.current.get(capturedKey) !== sequence
      ) {
        return false;
      }
      setStates((current) => {
        const previous = current[capturedKey] ?? EMPTY_STATE;
        if (response.status === "ok") {
          return {
            ...current,
            [capturedKey]: {
              ...previous,
              error: null,
              report: response.report,
              running: false,
              unavailable: null,
            },
          };
        }
        return {
          ...current,
          [capturedKey]: {
            ...previous,
            error: response.status === "error" ? response.message : null,
            running: false,
            unavailable: response.status === "unavailable" ? response.message : null,
          },
        };
      });
      return response.status === "ok";
    } catch (error) {
      if (
        currentKeyRef.current === capturedKey &&
        sequencesRef.current.get(capturedKey) === sequence
      ) {
        setStates((current) => ({
          ...current,
          [capturedKey]: {
            ...(current[capturedKey] ?? EMPTY_STATE),
            error: errorMessage(error),
            running: false,
          },
        }));
      }
      return false;
    } finally {
      inFlightRef.current.delete(capturedKey);
      setStates((current) => {
        const previous = current[capturedKey];
        if (!previous?.running) return current;
        return { ...current, [capturedKey]: { ...previous, running: false } };
      });
    }
  }, [gateway, rootPath, workspaceKey, workspaceTrusted]);

  const clear = useCallback(() => {
    if (!workspaceKey) return;
    sequencesRef.current.set(workspaceKey, (sequencesRef.current.get(workspaceKey) ?? 0) + 1);
    setStates((current) => ({
      ...current,
      [workspaceKey]: {
        ...EMPTY_STATE,
        running: current[workspaceKey]?.running ?? false,
      },
    }));
  }, [workspaceKey]);

  useEffect(() => {
    const previousKey = previousKeyRef.current;
    previousKeyRef.current = workspaceKey;
    if (previousKey && previousKey !== workspaceKey) {
      sequencesRef.current.set(previousKey, (sequencesRef.current.get(previousKey) ?? 0) + 1);
    }
  }, [workspaceKey]);

  useEffect(() => {
    if (!workspaceKey) return;
    const previousVersion = invalidationVersionsRef.current.get(workspaceKey);
    invalidationVersionsRef.current.set(workspaceKey, invalidationVersion);
    if (previousVersion === undefined || previousVersion === invalidationVersion) return;
    sequencesRef.current.set(workspaceKey, (sequencesRef.current.get(workspaceKey) ?? 0) + 1);
    setStates((current) => ({
      ...current,
      [workspaceKey]: {
        ...EMPTY_STATE,
        running: current[workspaceKey]?.running ?? false,
      },
    }));
  }, [invalidationVersion, workspaceKey]);

  useEffect(() => {
    if (!workspaceKey) return;
    if (!workspaceTrusted) {
      sequencesRef.current.set(workspaceKey, (sequencesRef.current.get(workspaceKey) ?? 0) + 1);
      setStates((current) => {
        const previous = current[workspaceKey] ?? EMPTY_STATE;
        const unavailable = "Trust this workspace to run JavaScript test coverage.";
        if (previous.unavailable === unavailable) return current;
        return {
          ...current,
          [workspaceKey]: {
            ...previous,
            unavailable,
          },
        };
      });
      return;
    }
    setStates((current) => {
      const previous = current[workspaceKey];
      if (!previous?.unavailable) return current;
      return { ...current, [workspaceKey]: { ...previous, unavailable: null } };
    });
  }, [workspaceKey, workspaceTrusted]);

  return {
    clear,
    error: state.error,
    isRunning: state.running,
    report: state.report,
    run,
    unavailable: state.unavailable,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
