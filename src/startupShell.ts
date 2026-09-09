export const STARTUP_SHELL_PAINT_TIMEOUT_MS = 250;
export const FIRST_CONTENTFUL_PAINT_ENTRY = "first-contentful-paint";
export const FIRST_PAINT_ENTRY = "first-paint";

export type StartupShellPaintOutcome = "painted" | "timeout";
export type StartupPaintSource = "paint-timing" | "frame";

export interface PaintTimingEntry {
  readonly name: string;
  readonly startTime: number;
}

export interface StartupPaintMeasurement {
  readonly rendererElapsedMs: number;
  readonly source: StartupPaintSource;
}

export function startupShellPaintWasObserved(outcome: StartupShellPaintOutcome): boolean {
  return outcome === "painted";
}

export function measureStartupShellPaint(
  frameElapsedMs: number,
  paintEntries: readonly PaintTimingEntry[],
): StartupPaintMeasurement | null {
  const reported = firstPaintEntryTime(paintEntries);
  if (reported !== null) {
    return { rendererElapsedMs: reported, source: "paint-timing" };
  }

  if (!isElapsedMs(frameElapsedMs)) {
    return null;
  }

  return { rendererElapsedMs: frameElapsedMs, source: "frame" };
}

function firstPaintEntryTime(paintEntries: readonly PaintTimingEntry[]): number | null {
  for (const name of [FIRST_CONTENTFUL_PAINT_ENTRY, FIRST_PAINT_ENTRY]) {
    const match = paintEntries.find((entry) => entry.name === name && isElapsedMs(entry.startTime));
    if (match !== undefined) {
      return match.startTime;
    }
  }

  return null;
}

function isElapsedMs(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

interface StartupPaintScheduler {
  readonly cancelTimer: (timer: ReturnType<typeof setTimeout>) => void;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly scheduleTimer: (
    callback: () => void,
    timeoutMs: number,
  ) => ReturnType<typeof setTimeout>;
}

const browserStartupPaintScheduler: StartupPaintScheduler = {
  cancelTimer: (timer) => clearTimeout(timer),
  requestFrame: (callback) => requestAnimationFrame(callback),
  scheduleTimer: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
};

export function waitForStartupShellPaint(
  scheduler: StartupPaintScheduler = browserStartupPaintScheduler,
): Promise<StartupShellPaintOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (outcome: StartupShellPaintOutcome) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        scheduler.cancelTimer(timer);
      }
      resolve(outcome);
    };
    timer = scheduler.scheduleTimer(() => finish("timeout"), STARTUP_SHELL_PAINT_TIMEOUT_MS);
    scheduler.requestFrame(() => scheduler.requestFrame(() => finish("painted")));
  });
}
