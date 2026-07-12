import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PhpTestCase,
  PhpTestGateway,
  PhpTestRunOk,
  PhpTestRunResponse,
  PhpTestSuite,
  PhpTestTotals,
} from "../domain/phpTestResults";
import { phpTestCaseCanRun } from "../domain/phpTestResults";

interface RootPhpTestState {
  filter?: string;
  isRunning: boolean;
  result: PhpTestRunResponse | null;
}

export interface UsePhpTestResultsOptions {
  gateway: PhpTestGateway;
  isOpen: boolean;
  rootPath: string | null;
  runRequestVersion: number;
  workspaceTrusted: boolean;
}

export interface PhpTestResultsState {
  clear(): void;
  error: string | null;
  filter: string | null;
  isRunning: boolean;
  result: PhpTestRunOk | null;
  run(): Promise<void>;
  runCase(testCase: PhpTestCase): Promise<void>;
  suites: PhpTestSuite[];
  totals: PhpTestTotals | null;
  unavailable: string | null;
}

const emptyState: RootPhpTestState = { isRunning: false, result: null };
const trustMessage = "Trust this workspace to run PHP tests.";

export function usePhpTestResults({
  gateway,
  isOpen,
  rootPath,
  runRequestVersion,
  workspaceTrusted,
}: UsePhpTestResultsOptions): PhpTestResultsState {
  const [states, setStates] = useState<Record<string, RootPhpTestState>>({});
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
  }, [gateway, rootPath, workspaceTrusted]);

  const run = useCallback(() => execute(), [execute]);

  const runCase = useCallback(
    (testCase: PhpTestCase) => {
      if (!phpTestCaseCanRun(testCase) || !testCase.name) {
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
