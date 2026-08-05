const PREFLIGHT_FRAME_COUNT = 12;
const PREFLIGHT_TIMEOUT_MS = 2_000;
const PREFLIGHT_MAX_FRAME_GAP_MS = 100;

export type PerfAutorunWindowMode = "focus-only" | "always-on-top-diagnostic";
export type PerfAutorunWindowActivationBoundary = "generic-window-control" | "authenticated-native";

export interface PerfAutorunWindowControl {
  show(): Promise<void>;
  unminimize(): Promise<void>;
  setFocus(): Promise<void>;
  isAlwaysOnTop(): Promise<boolean>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
}

export interface PerfAutorunWindowLease {
  readonly control: PerfAutorunWindowControl;
  readonly originalAlwaysOnTop: boolean;
  changedAlwaysOnTop: boolean;
}

export interface MeasurementWindowDependencies {
  readonly acquireWindowControl: () => Promise<PerfAutorunWindowControl | null>;
  readonly logError: (message: string) => void;
  readonly windowMode: PerfAutorunWindowMode;
}

export async function acquireWindowControlSafely(
  dependencies: MeasurementWindowDependencies,
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

export async function prepareMeasurementWindow(
  dependencies: Pick<MeasurementWindowDependencies, "windowMode"> & {
    readonly activationBoundary: PerfAutorunWindowActivationBoundary;
  },
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
    ...(dependencies.activationBoundary === "generic-window-control"
      ? await windowCallFailure("setFocus", () => windowControl.setFocus())
      : []),
  ];

  if (failures.length === 0) {
    return lease;
  }

  await restoreMeasurementWindow(lease);
  throw new Error(
    `Perf autorun could not prepare the measurement window (${failures.join("; ")}).`,
  );
}

export async function restoreMeasurementWindow(
  lease: PerfAutorunWindowLease | null,
): Promise<void> {
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

export async function verifyMeasurementWindow(
  windowMode: PerfAutorunWindowMode,
  lease: PerfAutorunWindowLease,
): Promise<void> {
  const expectedAlwaysOnTop = windowMode === "always-on-top-diagnostic";
  const actualAlwaysOnTop = await lease.control.isAlwaysOnTop();

  if (actualAlwaysOnTop !== expectedAlwaysOnTop) {
    throw new Error(
      `Perf autorun window level changed during the run; expected always-on-top=${String(expectedAlwaysOnTop)}, got ${String(actualAlwaysOnTop)}.`,
    );
  }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
