export function createStartupShell(): HTMLElement {
  const shell = document.createElement("main");
  shell.setAttribute("aria-label", "Codevo Editor starting");
  shell.style.cssText =
    "display:grid;grid-template-columns:52px 1fr;min-height:100vh;background:#111418;color:#d5d9e2;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

  const rail = document.createElement("nav");
  rail.setAttribute("aria-label", "Primary activity loading");
  rail.style.cssText =
    "display:flex;flex-direction:column;align-items:center;gap:12px;padding:14px 0;border-right:1px solid #2a303a;background:#0b0d10";
  const brand = document.createElement("strong");
  brand.textContent = "C";
  brand.title = "Codevo";
  const activityPlaceholder = document.createElement("span");
  activityPlaceholder.setAttribute("aria-hidden", "true");
  activityPlaceholder.style.cssText = "width:22px;height:22px;border-radius:5px;background:#20252d";
  rail.append(brand, activityPlaceholder);

  const loading = document.createElement("section");
  loading.setAttribute("aria-live", "polite");
  loading.setAttribute("role", "status");
  loading.style.cssText = "display:grid;place-items:center;color:#aeb6c4";
  loading.textContent = "Loading Codevo…";
  shell.append(rail, loading);
  return shell;
}

export const STARTUP_SHELL_PAINT_TIMEOUT_MS = 250;
export type StartupShellPaintOutcome = "painted" | "timeout";

export function startupShellPaintWasObserved(outcome: StartupShellPaintOutcome): boolean {
  return outcome === "painted";
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
