export function createStartupShell(): HTMLElement {
  const shell = document.createElement("main");
  shell.setAttribute("aria-label", "Codevo Editor starting");
  shell.style.cssText =
    "display:grid;place-items:center;min-height:100vh;overflow:hidden;background:radial-gradient(circle at 50% 46%,#1d2430 0,#13171d 30%,#0c0f13 72%);color:#dce3ee;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

  const styles = document.createElement("style");
  styles.textContent =
    "@keyframes codevo-startup-spin{to{transform:rotate(360deg)}}@keyframes codevo-startup-pulse{50%{transform:scale(.96);opacity:.78}}";

  const loading = document.createElement("section");
  loading.setAttribute("aria-live", "polite");
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-label", "Loading Codevo");
  loading.setAttribute("data-startup-loader", "");
  loading.style.cssText =
    "display:grid;place-items:center;gap:18px;filter:drop-shadow(0 18px 38px rgba(0,0,0,.36))";

  const mark = document.createElement("div");
  mark.setAttribute("aria-hidden", "true");
  mark.style.cssText =
    "position:relative;display:grid;place-items:center;width:54px;height:54px;border:1px solid #343c49;border-radius:16px;background:linear-gradient(145deg,#232a35,#141920);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);font-size:19px;font-weight:700;letter-spacing:-.04em;animation:codevo-startup-pulse 1.8s ease-in-out infinite";
  mark.textContent = "C";
  const ring = document.createElement("span");
  ring.setAttribute("data-startup-spinner", "");
  ring.style.cssText =
    "position:absolute;inset:-7px;border:2px solid transparent;border-top-color:#8ab4f8;border-right-color:#8ab4f855;border-radius:50%;animation:codevo-startup-spin .9s linear infinite";
  mark.append(ring);

  const brand = document.createElement("strong");
  brand.style.cssText = "font-size:13px;font-weight:600;letter-spacing:.08em;color:#aeb8c7";
  brand.textContent = "CODEVO";
  loading.append(mark, brand);
  shell.append(styles, loading);
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
