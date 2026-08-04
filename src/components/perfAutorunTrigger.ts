import { editorQaBridgeEnabled } from "./editorQaBridge";
import { PERF_AUTORUN_PATHS, PERF_AUTORUN_TOKEN_HEADER } from "./perfAutorunEndpoints";
import { perfScenarioBridgeEnabled } from "./perfScenarioBridge";

const BRIDGE_WAIT_TIMEOUT_MS = 120_000;
const BRIDGE_POLL_MS = 100;

export interface PerfAutorunEnvironment {
  DEV?: boolean;
  VITE_CODEVO_PERF_AUTORUN?: string;
  VITE_CODEVO_PERF_BRIDGE?: string;
  VITE_CODEVO_QA_BRIDGE?: string;
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
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
}

export interface PerfAutorunDependencies {
  readonly bridgesReady: () => boolean;
  readonly importRunner: (modulePath: string) => Promise<unknown>;
  readonly postPayload: (resultPath: string, body: string, runToken: string) => Promise<void>;
  readonly acquireWindowControl: () => Promise<PerfAutorunWindowControl | null>;
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
  await elevateMeasurementWindow(dependencies, windowControl);

  try {
    const payload = await collectPayload(dependencies, runner);

    await reportPayload(dependencies, payload, runner.perfAutorunRunToken);
  } finally {
    await restoreMeasurementWindow(dependencies, windowControl);
  }
}

const defaultDependencies: PerfAutorunDependencies = {
  bridgesReady: () => Boolean(window.__codevoQa && window.__codevoPerf),
  importRunner: importRunnerModule,
  postPayload: postAutorunPayload,
  acquireWindowControl: acquireTauriWindowControl,
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

async function acquireWindowControlSafely(
  dependencies: PerfAutorunDependencies,
): Promise<PerfAutorunWindowControl | null> {
  try {
    return await dependencies.acquireWindowControl();
  } catch (error) {
    dependencies.logError(
      `Perf autorun could not acquire the app window control, so it cannot lift the window above other windows: ${errorMessage(error)}`,
    );

    return null;
  }
}

async function elevateMeasurementWindow(
  dependencies: PerfAutorunDependencies,
  windowControl: PerfAutorunWindowControl | null,
): Promise<void> {
  if (!windowControl) {
    return;
  }

  const failures = [
    ...(await windowCallFailure("show", () => windowControl.show())),
    ...(await windowCallFailure("unminimize", () => windowControl.unminimize())),
    ...(await windowCallFailure("setAlwaysOnTop(true)", () => windowControl.setAlwaysOnTop(true))),
    ...(await windowCallFailure("setFocus", () => windowControl.setFocus())),
  ];

  if (failures.length === 0) {
    return;
  }

  dependencies.logError(
    `Perf autorun could not fully lift the measurement window (${failures.join("; ")}); if the window stays occluded, WKWebView suspends requestAnimationFrame and the run aborts with the hidden-window diagnostics.`,
  );
}

async function restoreMeasurementWindow(
  dependencies: PerfAutorunDependencies,
  windowControl: PerfAutorunWindowControl | null,
): Promise<void> {
  if (!windowControl) {
    return;
  }

  const failures = await windowCallFailure("setAlwaysOnTop(false)", () =>
    windowControl.setAlwaysOnTop(false),
  );

  if (failures.length === 0) {
    return;
  }

  dependencies.logError(
    `Perf autorun could not restore the measurement window after the run (${failures.join("; ")}).`,
  );
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
