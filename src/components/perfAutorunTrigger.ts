import { PERF_AUTORUN_PATHS, PERF_AUTORUN_TOKEN_HEADER } from "./perfAutorunEndpoints";
import type { PerfAutorunEnvironment } from "./perfAutorunGate";
import {
  annotateDiagnosticWindowInterruptions,
  annotateReleasedNativeWindowState,
  createDiagnosticActivationLease,
  installMeasurementWindowGuard,
  throwIfDiagnosticActivationFailed,
  verifyDiagnosticWindowTransaction,
  type DiagnosticActivationLease,
  type PerfAutorunWindowGuard,
  type PerfAutorunWindowGuardOptions,
} from "./perfAutorunDiagnosticWindow";
import {
  assertNativeWindowTransitionEvidence,
  nativeWindowReady,
  nativeWindowTransitionCount,
  nativeWindowTransitionEvidenceValid,
  type PerfCaptureNativeWindowState,
} from "./perfCaptureNativeWindowState";
import {
  acquireWindowControlSafely,
  assertStableMeasurementWindow,
  prepareMeasurementWindow,
  restoreMeasurementWindow,
  verifyMeasurementWindow,
  type PerfAutorunWindowControl,
  type PerfAutorunWindowLease,
  type PerfAutorunWindowMode,
} from "./perfAutorunMeasurementWindow";
import { perfProductionCaptureEnabled } from "./perfProductionCapture";
import {
  activateProductionCaptureWindow,
  DIAGNOSTIC_PRODUCTION_CAPTURE_ACTIVATION_LIMITS,
  releaseProductionCaptureWindowLease,
  resetProductionCaptureWindowLeaseBaseline,
  snapshotProductionCaptureWindowLease,
} from "./perfProductionCaptureActivation";

const BRIDGE_WAIT_TIMEOUT_MS = 120_000;
const BRIDGE_POLL_MS = 100;
const PERF_PRODUCTION_CAPTURE_RUNNER_MODULE = "virtual:codevo-perf-production-runner";
const PERF_PRODUCTION_CAPTURE_PREPARE_FIXTURES_COMMAND = "perf_capture_prepare_fixture_trust";
const PERF_PRODUCTION_CAPTURE_SUBMIT_COMMAND = "perf_capture_submit";
const PRODUCTION_CAPTURE_BAKED =
  import.meta.env.DEV === false && import.meta.env.VITE_CODEVO_PERF_PRODUCTION_CAPTURE === "1";
const PRODUCTION_CAPTURE_RUN_TOKEN = PRODUCTION_CAPTURE_BAKED
  ? __CODEVO_PERF_CAPTURE_RUN_TOKEN__
  : "";

export type {
  PerfAutorunWindowControl,
  PerfAutorunWindowMode,
} from "./perfAutorunMeasurementWindow";
export { assertStableMeasurementWindow } from "./perfAutorunMeasurementWindow";
export {
  installMeasurementWindowGuard,
  type PerfAutorunWindowGuard,
} from "./perfAutorunDiagnosticWindow";

export { perfAutorunEnabled, type PerfAutorunEnvironment } from "./perfAutorunGate";

export interface PerfAutorunRunnerModule {
  readonly perfAutorunOptions: unknown;
  readonly perfAutorunRunToken: string;
  readonly default: (options: unknown) => Promise<unknown>;
}

export interface PerfAutorunDependencies {
  readonly abortProductionCapture: () => Promise<void>;
  readonly activateProductionCaptureWindow: (
    runToken: string,
  ) => Promise<PerfCaptureNativeWindowState>;
  readonly prepareProductionCaptureFixtures: (runToken: string) => Promise<void>;
  readonly reactivateDiagnosticProductionCaptureWindow: (
    runToken: string,
    leaseId: string,
  ) => Promise<PerfCaptureNativeWindowState>;
  readonly releaseDiagnosticProductionCaptureWindow: (
    runToken: string,
    leaseId: string,
  ) => Promise<PerfCaptureNativeWindowState>;
  readonly resetProductionCaptureWindowLeaseBaseline: (
    runToken: string,
    leaseId: string,
  ) => Promise<PerfCaptureNativeWindowState>;
  readonly snapshotProductionCaptureWindowLease: (
    runToken: string,
    leaseId: string,
  ) => Promise<PerfCaptureNativeWindowState>;
  readonly bridgesReady: () => boolean;
  readonly importRunner: (modulePath: string) => Promise<unknown>;
  readonly productionCaptureRunToken: string;
  readonly runnerModulePath: string;
  readonly postPayload: (resultPath: string, body: string, runToken: string) => Promise<void>;
  readonly acquireWindowControl: () => Promise<PerfAutorunWindowControl | null>;
  readonly windowMode: PerfAutorunWindowMode;
  readonly preflightMeasurementWindow: () => Promise<void>;
  readonly installMeasurementWindowGuard: (
    options?: PerfAutorunWindowGuardOptions,
  ) => PerfAutorunWindowGuard;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly logError: (message: string) => void;
}

export async function runPerfAutorun(
  overrides: Partial<PerfAutorunDependencies> = {},
): Promise<void> {
  const dependencies: PerfAutorunDependencies = { ...defaultDependencies, ...overrides };
  const runner = await loadRunner(dependencies);

  if (!runner) {
    if (dependencies.productionCaptureRunToken.length > 0) {
      const reported = await reportPayload(
        dependencies,
        errorPayload("Perf production capture could not load its bundled scenario runner."),
        dependencies.productionCaptureRunToken,
      );
      await abortUnreportedProductionCapture(dependencies, reported);
    }
    return;
  }

  const windowControl = await acquireWindowControlSafely(dependencies);
  let lease: PerfAutorunWindowLease | null = null;
  let guard: PerfAutorunWindowGuard | null = null;
  let diagnosticLease: DiagnosticActivationLease | null = null;
  const diagnosticSmoke = diagnosticSmokeEnabled(dependencies, runner);
  let nativeWindowLeaseRequested = false;
  let nativeWindowLeaseId = "";
  let initialDiagnosticSpaceLeaseObserved = false;
  let payload = errorPayload("Perf autorun did not produce a result.");

  try {
    lease = await prepareMeasurementWindow(
      {
        windowMode: dependencies.windowMode,
        activationBoundary:
          dependencies.productionCaptureRunToken.length > 0
            ? "authenticated-native"
            : "generic-window-control",
      },
      windowControl,
    );
    const measurementLease = lease;
    if (dependencies.productionCaptureRunToken.length > 0) {
      await dependencies.prepareProductionCaptureFixtures(dependencies.productionCaptureRunToken);
      const nativeState = await dependencies.activateProductionCaptureWindow(
        dependencies.productionCaptureRunToken,
      );
      if (!nativeState) {
        throw new Error(
          "Perf production capture did not acquire its native window observer lease.",
        );
      }
      nativeWindowLeaseRequested = true;
      nativeWindowLeaseId = nativeState.leaseId;
      if (diagnosticSmoke && !nativeState.diagnosticSpaceLease) {
        throw new Error("Perf diagnostic capture could not acquire its native window lease.");
      }
      if (!diagnosticSmoke && nativeState.diagnosticSpaceLease) {
        throw new Error("Perf focus-only capture unexpectedly acquired a diagnostic window lease.");
      }
      initialDiagnosticSpaceLeaseObserved = nativeState.diagnosticSpaceLease;

      await dependencies.preflightMeasurementWindow();
      const baseline = await dependencies.resetProductionCaptureWindowLeaseBaseline(
        dependencies.productionCaptureRunToken,
        nativeWindowLeaseId,
      );
      if (
        !baseline ||
        baseline.leaseId !== nativeWindowLeaseId ||
        !nativeWindowReady(baseline) ||
        baseline.diagnosticSpaceLease !== diagnosticSmoke ||
        nativeWindowTransitionCount(baseline) !== 0
      ) {
        throw new Error("Perf production capture native window baseline reset was not observed.");
      }
    }
    if (diagnosticSmoke) {
      diagnosticLease = createDiagnosticActivationLease(
        dependencies,
        dependencies.productionCaptureRunToken,
        nativeWindowLeaseId,
        initialDiagnosticSpaceLeaseObserved,
      );
    }
    guard = dependencies.installMeasurementWindowGuard(
      diagnosticLease
        ? { recordDiagnosticInterruption: diagnosticLease.recordInterruption }
        : undefined,
    );
    await dependencies.preflightMeasurementWindow();
    await diagnosticLease?.settle();
    throwIfDiagnosticActivationFailed(diagnosticLease);
    throwIfMeasurementWindowFailed(guard);
    if (nativeWindowLeaseRequested) {
      const baselineSnapshot = await dependencies.snapshotProductionCaptureWindowLease(
        dependencies.productionCaptureRunToken,
        nativeWindowLeaseId,
      );
      if (
        !baselineSnapshot ||
        baselineSnapshot.leaseId !== nativeWindowLeaseId ||
        !nativeWindowReady(baselineSnapshot) ||
        baselineSnapshot.diagnosticSpaceLease !== diagnosticSmoke ||
        nativeWindowTransitionCount(baselineSnapshot) !== 0
      ) {
        throw new Error("Perf production capture native window was unstable before samples.");
      }
      assertNativeWindowTransitionEvidence(baselineSnapshot);
    }
    payload = await collectPayload(dependencies, runner);
    await diagnosticLease?.settle();
    throwIfDiagnosticActivationFailed(diagnosticLease);
    throwIfMeasurementWindowFailed(guard);

    if (diagnosticLease) {
      await verifyDiagnosticWindowTransaction(
        dependencies,
        diagnosticLease,
        () => verifyMeasurementWindow(dependencies.windowMode, measurementLease),
        () => snapshotRequiredNativeWindow(dependencies, nativeWindowLeaseId, true),
      );
    } else {
      await verifyStrictProductionWindowTransaction(
        dependencies,
        measurementLease,
        guard,
        nativeWindowLeaseRequested ? nativeWindowLeaseId : null,
      );
    }
    throwIfMeasurementWindowFailed(guard);
    if (diagnosticLease) {
      payload = annotateDiagnosticWindowInterruptions(payload, diagnosticLease);
    }
  } catch (error) {
    payload = errorPayload(errorMessage(error));
  } finally {
    guard?.dispose();
    try {
      await diagnosticLease?.close();
      throwIfDiagnosticActivationFailed(diagnosticLease);
      if (guard) {
        throwIfMeasurementWindowFailed(guard);
      }
    } catch (error) {
      payload = errorPayload(errorMessage(error));
    }
    diagnosticLease?.dispose();
    if (nativeWindowLeaseRequested) {
      try {
        const releasedState = await dependencies.releaseDiagnosticProductionCaptureWindow(
          dependencies.productionCaptureRunToken,
          nativeWindowLeaseId,
        );
        if (
          !releasedState ||
          releasedState.leaseId !== nativeWindowLeaseId ||
          releasedState.diagnosticSpaceLease ||
          !nativeWindowTransitionEvidenceValid(releasedState)
        ) {
          payload = errorPayload(
            "Perf production capture could not release its native window observer lease.",
          );
        } else if (diagnosticSmoke) {
          payload = annotateReleasedNativeWindowState(payload, releasedState);
        } else if (nativeWindowTransitionCount(releasedState) !== 0) {
          payload = errorPayload(
            "Perf focus-only capture observed a native window transition during the run.",
          );
        }
      } catch {
        payload = errorPayload(
          "Perf production capture could not release its native window observer lease.",
        );
      }
    }
  }

  try {
    await restoreMeasurementWindow(lease);
  } catch (error) {
    payload = errorPayload(errorMessage(error));
  }

  const reported = await reportPayload(dependencies, payload, runner.perfAutorunRunToken);
  await abortUnreportedProductionCapture(dependencies, reported);
}

function throwIfMeasurementWindowFailed(guard: PerfAutorunWindowGuard): void {
  const failure = guard.failure();

  if (failure !== null) {
    throw new Error(failure);
  }
}

async function snapshotRequiredNativeWindow(
  dependencies: PerfAutorunDependencies,
  leaseId: string,
  diagnosticSpaceLeaseExpected: boolean,
): Promise<PerfCaptureNativeWindowState> {
  const state = await dependencies.snapshotProductionCaptureWindowLease(
    dependencies.productionCaptureRunToken,
    leaseId,
  );
  if (!state || state.leaseId !== leaseId) {
    throw new Error("Perf production capture native window observer lease identity was invalid.");
  }
  assertNativeWindowTransitionEvidence(state);
  if (!nativeWindowReady(state) || state.diagnosticSpaceLease !== diagnosticSpaceLeaseExpected) {
    throw new Error("Perf production capture native window snapshot was not ready.");
  }
  return state;
}

async function verifyStrictProductionWindowTransaction(
  dependencies: PerfAutorunDependencies,
  lease: PerfAutorunWindowLease,
  guard: PerfAutorunWindowGuard,
  nativeLeaseId: string | null,
): Promise<void> {
  const nativeBefore = nativeLeaseId
    ? await snapshotRequiredNativeWindow(dependencies, nativeLeaseId, false)
    : null;
  if (nativeBefore && nativeWindowTransitionCount(nativeBefore) !== 0) {
    throw new Error("Perf focus-only capture observed a native window transition during the run.");
  }

  await dependencies.preflightMeasurementWindow();
  throwIfMeasurementWindowFailed(guard);
  await verifyMeasurementWindow(dependencies.windowMode, lease);
  throwIfMeasurementWindowFailed(guard);

  if (nativeLeaseId) {
    const nativeAfter = await snapshotRequiredNativeWindow(dependencies, nativeLeaseId, false);
    if (
      nativeAfter.windowStabilityEpoch !== nativeBefore?.windowStabilityEpoch ||
      nativeWindowTransitionCount(nativeAfter) !== 0
    ) {
      throw new Error(
        "Perf focus-only capture observed a native window transition during the run.",
      );
    }
  }
}

const defaultDependencies: PerfAutorunDependencies = {
  abortProductionCapture: quitProductionCaptureApp,
  activateProductionCaptureWindow,
  prepareProductionCaptureFixtures: prepareProductionCaptureFixtures,
  reactivateDiagnosticProductionCaptureWindow: async (runToken, leaseId) => {
    const state = await activateProductionCaptureWindow(
      runToken,
      {},
      DIAGNOSTIC_PRODUCTION_CAPTURE_ACTIVATION_LIMITS,
      leaseId,
    );
    if (!state.diagnosticSpaceLease) {
      throw new Error(
        "Production capture window did not converge; native.diagnosticSpaceLease=false.",
      );
    }
    return state;
  },
  releaseDiagnosticProductionCaptureWindow: (runToken, leaseId) =>
    releaseProductionCaptureWindowLease(runToken, leaseId),
  resetProductionCaptureWindowLeaseBaseline,
  snapshotProductionCaptureWindowLease,
  bridgesReady: () => Boolean(window.__codevoQa && window.__codevoPerf),
  importRunner: importRunnerModule,
  productionCaptureRunToken: PRODUCTION_CAPTURE_RUN_TOKEN,
  runnerModulePath: perfAutorunRunnerModulePath(),
  postPayload: postAutorunPayload,
  acquireWindowControl: acquireTauriWindowControl,
  windowMode: perfAutorunWindowMode(),
  preflightMeasurementWindow: assertStableMeasurementWindow,
  installMeasurementWindowGuard,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logError: (message) => {
    console.error(message);
  },
};

async function prepareProductionCaptureFixtures(runToken: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(PERF_PRODUCTION_CAPTURE_PREPARE_FIXTURES_COMMAND, { runToken });
}

async function quitProductionCaptureApp(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("quit_application");
}

async function abortUnreportedProductionCapture(
  dependencies: PerfAutorunDependencies,
  reported: boolean,
): Promise<void> {
  if (reported || dependencies.productionCaptureRunToken.length === 0) {
    return;
  }

  try {
    await dependencies.abortProductionCapture();
  } catch (error) {
    dependencies.logError(
      `Perf production capture could not terminate after report failure: ${errorMessage(error)}`,
    );
  }
}

async function acquireTauriWindowControl(): Promise<PerfAutorunWindowControl | null> {
  const { isTauri } = await import("@tauri-apps/api/core");

  if (!isTauri()) {
    return null;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");

  return getCurrentWindow();
}

function diagnosticSmokeEnabled(
  dependencies: PerfAutorunDependencies,
  runner: PerfAutorunRunnerModule,
): boolean {
  return (
    dependencies.productionCaptureRunToken.length > 0 &&
    dependencies.windowMode === "always-on-top-diagnostic" &&
    isSmokeOptions(runner.perfAutorunOptions)
  );
}

function isSmokeOptions(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { readonly smoke?: unknown }).smoke === true,
  );
}

function perfAutorunWindowMode(
  environment: PerfAutorunEnvironment = import.meta.env,
): PerfAutorunWindowMode {
  return environment.VITE_CODEVO_PERF_WINDOW_MODE === "always-on-top-diagnostic"
    ? "always-on-top-diagnostic"
    : "focus-only";
}

async function loadRunner(
  dependencies: PerfAutorunDependencies,
): Promise<PerfAutorunRunnerModule | null> {
  try {
    const loaded = await dependencies.importRunner(dependencies.runnerModulePath);

    return asRunnerModule(loaded, dependencies.runnerModulePath);
  } catch (error) {
    dependencies.logError(
      `Perf autorun could not load ${dependencies.runnerModulePath}, so it holds no run token and can report nothing to the driver: ${errorMessage(error)}`,
    );

    return null;
  }
}

async function collectPayload(
  dependencies: PerfAutorunDependencies,
  runner: PerfAutorunRunnerModule,
): Promise<string> {
  try {
    const ready = await waitForBridges(dependencies);

    if (!ready) {
      return errorPayload(
        `Perf autorun found no QA/performance bridges (window.__codevoQa and window.__codevoPerf) within ${BRIDGE_WAIT_TIMEOUT_MS} ms.`,
      );
    }

    const result = await runner.default(runner.perfAutorunOptions);

    return JSON.stringify({ status: "ok", result });
  } catch (error) {
    return errorPayload(errorMessage(error));
  }
}

async function reportPayload(
  dependencies: PerfAutorunDependencies,
  payload: string,
  runToken: string,
): Promise<boolean> {
  try {
    await dependencies.postPayload(PERF_AUTORUN_PATHS.result, payload, runToken);
    return true;
  } catch (error) {
    dependencies.logError(
      `Perf autorun could not report its result to ${PERF_AUTORUN_PATHS.result}: ${errorMessage(error)}`,
    );
    return false;
  }
}

async function waitForBridges(dependencies: PerfAutorunDependencies): Promise<boolean> {
  const startedAt = dependencies.now();

  while (dependencies.now() - startedAt < BRIDGE_WAIT_TIMEOUT_MS) {
    if (dependencies.bridgesReady()) {
      return true;
    }

    await dependencies.sleep(BRIDGE_POLL_MS);
  }

  return false;
}

async function importRunnerModule(modulePath: string): Promise<unknown> {
  if (PRODUCTION_CAPTURE_BAKED && modulePath === PERF_PRODUCTION_CAPTURE_RUNNER_MODULE) {
    return await import("virtual:codevo-perf-production-runner");
  }

  return await import(/* @vite-ignore */ modulePath);
}

export function perfAutorunRunnerModulePath(
  environment: PerfAutorunEnvironment = import.meta.env,
): string {
  return perfProductionCaptureEnabled(environment)
    ? PERF_PRODUCTION_CAPTURE_RUNNER_MODULE
    : PERF_AUTORUN_PATHS.runner;
}

function asRunnerModule(loaded: unknown, modulePath: string): PerfAutorunRunnerModule {
  const candidate = loaded as Partial<PerfAutorunRunnerModule> | null;

  if (typeof candidate?.default !== "function") {
    throw new Error(`${modulePath} exported no perf runner function as its default export`);
  }

  if (candidate.perfAutorunOptions === undefined) {
    throw new Error(`${modulePath} exported no perfAutorunOptions for the perf runner`);
  }

  if (typeof candidate.perfAutorunRunToken !== "string" || candidate.perfAutorunRunToken === "") {
    throw new Error(`${modulePath} exported no perfAutorunRunToken for this run`);
  }

  return {
    default: candidate.default,
    perfAutorunOptions: candidate.perfAutorunOptions,
    perfAutorunRunToken: candidate.perfAutorunRunToken,
  };
}

export interface PerfAutorunPayloadTransport {
  readonly fetch: typeof fetch;
  readonly invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
}

export async function postAutorunPayload(
  resultPath: string,
  body: string,
  runToken: string,
  environment: PerfAutorunEnvironment = import.meta.env,
  transport: PerfAutorunPayloadTransport = defaultPayloadTransport,
): Promise<void> {
  if (perfProductionCaptureEnabled(environment)) {
    await transport.invoke(PERF_PRODUCTION_CAPTURE_SUBMIT_COMMAND, {
      payload: body,
      runToken,
    });
    return;
  }

  const response = await transport.fetch(resultPath, {
    method: "POST",
    headers: { "content-type": "application/json", [PERF_AUTORUN_TOKEN_HEADER]: runToken },
    body,
  });

  if (response.ok) {
    return;
  }

  throw new Error(`the relay answered HTTP ${response.status}`);
}

const defaultPayloadTransport: PerfAutorunPayloadTransport = {
  fetch: (...args) => fetch(...args),
  invoke: async (command, args) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(command, args);
  },
};

function errorPayload(message: string): string {
  return JSON.stringify({ status: "error", message });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
