import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TestCase,
  TestGateway,
  TestRunOk,
  TestRunResponse,
  TestSuite,
  TestTotals,
} from "../domain/testResults";
import { testCaseCanRun } from "../domain/testResults";

interface RootTestState {
  filter?: string;
  isRunning: boolean;
  result: TestRunResponse | null;
}

export interface UseHeadlessTestResultsOptions {
  gateway: TestGateway;
  isOpen: boolean;
  rootPath: string | null;
  runRequestVersion: number;
  trustMessage: string;
  workspaceTrusted: boolean;
}

export interface HeadlessTestResultsState {
  clear(): void;
  error: string | null;
  filter: string | null;
  isRunning: boolean;
  result: TestRunOk | null;
  run(): Promise<void>;
  runCase(testCase: TestCase): Promise<void>;
  suites: TestSuite[];
  totals: TestTotals | null;
  unavailable: string | null;
}

const emptyState: RootTestState = { isRunning: false, result: null };

export function useHeadlessTestResults({
  gateway,
  isOpen,
  rootPath,
  runRequestVersion,
  trustMessage,
  workspaceTrusted,
}: UseHeadlessTestResultsOptions): HeadlessTestResultsState {
  const [states, setStates] = useState<Record<string, RootTestState>>({});
  const inFlightRootsRef = useRef(new Set<string>());
  const runRequestVersionRef = useRef(runRequestVersion);
  const state = rootPath ? states[rootPath] ?? emptyState : emptyState;

  const execute = useCallback(async (filter?: string) => {
    const requestedRoot = rootPath;

    if (!requestedRoot || inFlightRootsRef.current.has(requestedRoot)) {
      return;
    }

    if (!workspaceTrusted) {
      setStates((current) => ({
        ...current,
        [requestedRoot]: {
          filter,
          isRunning: false,
          result: { status: "unavailable", message: trustMessage },
        },
      }));
      return;
    }

    inFlightRootsRef.current.add(requestedRoot);
    setStates((current) => ({
      ...current,
      [requestedRoot]: {
        filter,
        isRunning: true,
        result: current[requestedRoot]?.result ?? null,
      },
    }));

    try {
      const result = await gateway.run(requestedRoot, filter);
      setStates((current) => ({
        ...current,
        [requestedRoot]: { filter, isRunning: false, result },
      }));
    } catch (error) {
      setStates((current) => ({
        ...current,
        [requestedRoot]: {
          filter,
          isRunning: false,
          result: {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      }));
    } finally {
      inFlightRootsRef.current.delete(requestedRoot);
    }
  }, [gateway, rootPath, trustMessage, workspaceTrusted]);

  const run = useCallback(() => execute(), [execute]);

  const runCase = useCallback(
    (testCase: TestCase) => {
      if (!testCaseCanRun(testCase) || !testCase.name) {
        return Promise.resolve();
      }

      return execute(testCase.name);
    },
    [execute],
  );

  useEffect(() => {
    if (!isOpen || !rootPath || states[rootPath]) {
      return;
    }

    void run();
  }, [isOpen, rootPath, run, states]);

  useEffect(() => {
    if (runRequestVersionRef.current === runRequestVersion) {
      return;
    }

    runRequestVersionRef.current = runRequestVersion;
    void run();
  }, [run, runRequestVersion]);

  const clear = useCallback(() => {
    if (!rootPath || inFlightRootsRef.current.has(rootPath)) {
      return;
    }

    setStates((current) => {
      const next = { ...current };
      delete next[rootPath];
      return next;
    });
  }, [rootPath]);

  const result = state.result?.status === "ok" ? state.result : null;

  return {
    clear,
    error: state.result?.status === "error" ? state.result.message : null,
    filter: state.filter ?? null,
    isRunning: state.isRunning,
    result,
    run,
    runCase,
    suites: result?.suites ?? [],
    totals: result?.totals ?? null,
    unavailable:
      state.result?.status === "unavailable" ? state.result.message : null,
  };
}
