import { editorQaBridgeEnabled } from "./editorQaBridge";
import { PERF_AUTORUN_PATHS, PERF_AUTORUN_TOKEN_HEADER } from "./perfAutorunEndpoints";
import { perfScenarioBridgeEnabled } from "./perfScenarioBridge";

const BRIDGE_WAIT_TIMEOUT_MS = 120_000;
const BRIDGE_POLL_MS = 100;
const PREFLIGHT_FRAME_COUNT = 12;
const PREFLIGHT_TIMEOUT_MS = 2_000;
const PREFLIGHT_MAX_FRAME_GAP_MS = 100;

export type PerfAutorunWindowMode = "focus-only" | "always-on-top-diagnostic";

export interface PerfAutorunEnvironment {
  DEV?: boolean;
  VITE_CODEVO_PERF_AUTORUN?: string;
  VITE_CODEVO_PERF_BRIDGE?: string;
  VITE_CODEVO_QA_BRIDGE?: string;
  VITE_CODEVO_PERF_WINDOW_MODE?: string;
}

export interface PerfAutorunRunnerModule {
  readonly perfAutorunOptions: unknown;
  readonly perfAutorunRunToken: string;
  readonly default: (options: unknown) => Promise<unknown>;
}

export interface PerfAutorunWindowControl {
  show(): Promise<void>;
  unminimize(): Promise<void>;
  setFocus(): Promise<void>;
  isAlwaysOnTop(): Promise<boolean>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
}

interface PerfAutorunWindowLease {
  readonly control: PerfAutorunWindowControl;
  readonly originalAlwaysOnTop: boolean;
  changedAlwaysOnTop: boolean;
}

export interface PerfAutorunWindowGuard {
  failure(): string | null;
  dispose(): void;
}

export interface PerfAutorunDependencies {
  readonly bridgesReady: () => boolean;
  readonly importRunner: (modulePath: string) => Promise<unknown>;
  readonly postPayload: (resultPath: string, body: string, runToken: string) => Promise<void>;
  readonly acquireWindowControl: () => Promise<PerfAutorunWindowControl | null>;
  readonly windowMode: PerfAutorunWindowMode;
  readonly preflightMeasurementWindow: () => Promise<void>;
  readonly installMeasurementWindowGuard: () => PerfAutorunWindowGuard;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly logError: (message: string) => void;
}

export function perfAutorunEnabled(
  environment: PerfAutorunEnvironment = import.meta.env,
  storage: Pick<Storage, "getItem"> | null | undefined = window.localStorage,
): boolean {
  if (!environment.DEV) {
    return false;
  }

  if (environment.VITE_CODEVO_PERF_AUTORUN !== "1") {
    return false;
  }

  if (!perfScenarioBridgeEnabled(environment, storage)) {
    return false;
  }

  return editorQaBridgeEnabled(environment, storage);
}

export async function runPerfAutorun(
  overrides: Partial<PerfAutorunDependencies> = {},
): Promise<void> {
  const dependencies: PerfAutorunDependencies = { ...defaultDependencies, ...overrides };
  const runner = await loadRunner(dependencies);

  if (!runner) {
    return;
  }

  const windowControl = await acquireWindowControlSafely(dependencies);
  let lease: PerfAutorunWindowLease | null = null;
  let guard: PerfAutorunWindowGuard | null = null;
  let payload: string;

  try {
    lease = await prepareMeasurementWindow(dependencies, windowControl);
    guard = dependencies.installMeasurementWindowGuard();
    await dependencies.preflightMeasurementWindow();
    throwIfMeasurementWindowFailed(guard);
    payload = await collectPayload(dependencies, runner);
    throwIfMeasurementWindowFailed(guard);

    await dependencies.preflightMeasurementWindow();
    throwIfMeasurementWindowFailed(guard);
    await verifyMeasurementWindow(dependencies, lease);
    throwIfMeasurementWindowFailed(guard);
  } catch (error) {
    payload = errorPayload(errorMessage(error));
  } finally {
    guard?.dispose();
  }

  try {
    await restoreMeasurementWindow(lease);
  } catch (error) {
    payload = errorPayload(errorMessage(error));
  }

  await reportPayload(dependencies, payload, runner.perfAutorunRunToken);
}

function throwIfMeasurementWindowFailed(guard: PerfAutorunWindowGuard): void {
  const failure = guard.failure();

  if (failure !== null) {
    throw new Error(failure);
  }
}

const defaultDependencies: PerfAutorunDependencies = {
  bridgesReady: () => Boolean(window.__codevoQa && window.__codevoPerf),
  importRunner: importRunnerModule,
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

async function acquireTauriWindowControl(): Promise<PerfAutorunWindowControl | null> {
  const { isTauri } = await import("@tauri-apps/api/core");

  if (!isTauri()) {
    return null;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");

  return getCurrentWindow();
}

export function installMeasurementWindowGuard(): PerfAutorunWindowGuard {
  let failure: string | null = null;
  const recordBlur = () => {
    failure ??= "Perf autorun measurement window lost focus during the run.";
  };
  const recordVisibility = () => {
    if (document.visibilityState !== "visible") {
      failure ??= `Perf autorun measurement window became ${document.visibilityState} during the run.`;
    }
  };
  const recordResize = () => {
    failure ??= "Perf autorun measurement window was resized during the run.";
  };

  window.addEventListener("blur", recordBlur);
  window.addEventListener("resize", recordResize);
  document.addEventListener("visibilitychange", recordVisibility);

  return {
    failure: () => failure,
    dispose: () => {
      window.removeEventListener("blur", recordBlur);
      window.removeEventListener("resize", recordResize);
      document.removeEventListener("visibilitychange", recordVisibility);
    },
  };
}

async function verifyMeasurementWindow(
  dependencies: PerfAutorunDependencies,
  lease: PerfAutorunWindowLease,
): Promise<void> {
  const expectedAlwaysOnTop = dependencies.windowMode === "always-on-top-diagnostic";
  const actualAlwaysOnTop = await lease.control.isAlwaysOnTop();

  if (actualAlwaysOnTop !== expectedAlwaysOnTop) {
    throw new Error(
      `Perf autorun window level changed during the run; expected always-on-top=${String(expectedAlwaysOnTop)}, got ${String(actualAlwaysOnTop)}.`,
    );
  }
}

async function acquireWindowControlSafely(
  dependencies: PerfAutorunDependencies,
): Promise<PerfAutorunWindowControl | null> {
  try {
    return await dependencies.acquireWindowControl();
  } catch (error) {
    dependencies.logError(
      `Perf autorun could not acquire authoritative native window state: ${errorMessage(error)}`,
    );

    return null;
  }
}

function perfAutorunWindowMode(
  environment: PerfAutorunEnvironment = import.meta.env,
): PerfAutorunWindowMode {
  return environment.VITE_CODEVO_PERF_WINDOW_MODE === "always-on-top-diagnostic"
    ? "always-on-top-diagnostic"
    : "focus-only";
}

async function prepareMeasurementWindow(
  dependencies: PerfAutorunDependencies,
  windowControl: PerfAutorunWindowControl | null,
): Promise<PerfAutorunWindowLease> {
  if (!windowControl) {
    throw new Error("Perf autorun could not acquire authoritative window control.");
  }

  const originalAlwaysOnTop = await windowControl.isAlwaysOnTop();
  const lease: PerfAutorunWindowLease = {
    control: windowControl,
    originalAlwaysOnTop,
    changedAlwaysOnTop: false,
  };

  if (dependencies.windowMode === "focus-only" && originalAlwaysOnTop) {
    throw new Error(
      "Perf autorun focus-only mode found an already always-on-top window; the run is invalid.",
    );
  }

  const failures = [
    ...(await windowCallFailure("show", () => windowControl.show())),
    ...(await windowCallFailure("unminimize", () => windowControl.unminimize())),
    ...(dependencies.windowMode === "always-on-top-diagnostic" && !originalAlwaysOnTop
      ? await windowCallFailure("setAlwaysOnTop(true)", async () => {
          lease.changedAlwaysOnTop = true;
          await windowControl.setAlwaysOnTop(true);
        })
      : []),
    ...(await windowCallFailure("setFocus", () => windowControl.setFocus())),
  ];

  if (failures.length === 0) {
    return lease;
  }

  await restoreMeasurementWindow(lease);
  throw new Error(
    `Perf autorun could not prepare the measurement window (${failures.join("; ")}).`,
  );
}

async function restoreMeasurementWindow(lease: PerfAutorunWindowLease | null): Promise<void> {
  if (!lease || !lease.changedAlwaysOnTop) {
    return;
  }

  const failures = await windowCallFailure(
    `setAlwaysOnTop(${String(lease.originalAlwaysOnTop)})`,
    () => lease.control.setAlwaysOnTop(lease.originalAlwaysOnTop),
  );

  if (failures.length === 0) {
    return;
  }

  throw new Error(
    `Perf autorun could not restore the measurement window after the run (${failures.join("; ")}).`,
  );
}

export async function assertStableMeasurementWindow(): Promise<void> {
  if (document.visibilityState !== "visible") {
    throw new Error(
      `Perf autorun requires a visible measurement window; visibility is ${document.visibilityState}.`,
    );
  }

  if (typeof document.hasFocus !== "function" || !document.hasFocus()) {
    throw new Error("Perf autorun requires the measurement window to have focus.");
  }

  const startedAt = performance.now();
  const frameTimes: number[] = [];

  await withPreflightTimeout(collectAnimationFrames(frameTimes, PREFLIGHT_FRAME_COUNT));

  const timestamps = [startedAt, ...frameTimes];
  const gaps = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);
  const largestGap = Math.max(...gaps);

  if (!Number.isFinite(largestGap) || largestGap > PREFLIGHT_MAX_FRAME_GAP_MS) {
    throw new Error(
      `Perf autorun rAF preflight is unstable: largest frame gap ${String(largestGap)} ms exceeds ${PREFLIGHT_MAX_FRAME_GAP_MS} ms.`,
    );
  }
}

async function withPreflightTimeout(measurement: Promise<void>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    await Promise.race([
      measurement,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`Perf autorun rAF preflight exceeded ${PREFLIGHT_TIMEOUT_MS} ms.`)),
          PREFLIGHT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

function collectAnimationFrames(samples: number[], remaining: number): Promise<void> {
  if (remaining === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    requestAnimationFrame((timestamp) => {
      samples.push(timestamp);
      void collectAnimationFrames(samples, remaining - 1).then(resolve);
    });
  });
}

async function windowCallFailure(
  label: string,
  action: () => Promise<void>,
): Promise<readonly string[]> {
  try {
    await action();

    return [];
  } catch (error) {
    return [`${label}: ${errorMessage(error)}`];
  }
}

async function loadRunner(
  dependencies: PerfAutorunDependencies,
): Promise<PerfAutorunRunnerModule | null> {
  try {
    const loaded = await dependencies.importRunner(PERF_AUTORUN_PATHS.runner);

    return asRunnerModule(loaded, PERF_AUTORUN_PATHS.runner);
  } catch (error) {
    dependencies.logError(
      `Perf autorun could not load ${PERF_AUTORUN_PATHS.runner}, so it holds no run token and can report nothing to the driver: ${errorMessage(error)}`,
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
): Promise<void> {
  try {
    await dependencies.postPayload(PERF_AUTORUN_PATHS.result, payload, runToken);
  } catch (error) {
    dependencies.logError(
      `Perf autorun could not report its result to ${PERF_AUTORUN_PATHS.result}: ${errorMessage(error)}`,
    );
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
  return await import(/* @vite-ignore */ modulePath);
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

async function postAutorunPayload(
  resultPath: string,
  body: string,
  runToken: string,
): Promise<void> {
  const response = await fetch(resultPath, {
    method: "POST",
    headers: { "content-type": "application/json", [PERF_AUTORUN_TOKEN_HEADER]: runToken },
    body,
  });

  if (response.ok) {
    return;
  }

  throw new Error(`the relay answered HTTP ${response.status}`);
}

function errorPayload(message: string): string {
  return JSON.stringify({ status: "error", message });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
