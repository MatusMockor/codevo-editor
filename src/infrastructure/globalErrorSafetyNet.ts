// Global last-resort safety net for errors that a React ErrorBoundary cannot
// catch: exceptions thrown in event handlers (onClick), in async work
// (promises, setTimeout, await) and any other uncaught runtime failure that
// reaches `window`. A render-time ErrorBoundary only catches throws during the
// render/commit of components BELOW it; everything else escapes it. Without a
// global net those failures are invisible (best case a silent console.error)
// or, when they tear React down, leave a blank screen with no way to recover.
//
// This installs `error` / `unhandledrejection` listeners that surface a
// dismissible, recoverable notice rendered directly into the DOM (independent
// of React, so it still appears even if the React tree has unmounted). It never
// blanks the app and never blocks interaction with the rest of the UI.
//
// Per-tab isolation: this is a process/window-level diagnostic overlay. It owns
// no workspace/session/runtime state and reads nothing from any project tab, so
// it cannot leak state between open tabs.

const OVERLAY_ID = "global-error-safety-net";

function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message || value.name || "An unexpected error occurred.";
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (value === null || value === undefined) {
    return "An unexpected error occurred.";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function styleOverlay(overlay: HTMLDivElement): void {
  overlay.style.position = "fixed";
  overlay.style.zIndex = "2147483647";
  overlay.style.right = "16px";
  overlay.style.bottom = "16px";
  overlay.style.maxWidth = "420px";
  overlay.style.boxSizing = "border-box";
  overlay.style.padding = "14px 16px";
  overlay.style.borderRadius = "8px";
  overlay.style.background = "#2a1416";
  overlay.style.border = "1px solid #6d2b30";
  overlay.style.color = "#f3d3d3";
  overlay.style.font =
    "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  overlay.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.45)";
}

/**
 * Installs the window-level error/rejection safety net. Returns an uninstall
 * function that removes the listeners and any visible overlay (used in tests
 * and safe to call if the module is ever re-initialised).
 */
export function installGlobalErrorSafetyNet(
  target: Window = window,
  container: HTMLElement = document.body,
): () => void {
  const showNotice = (rawError: unknown): void => {
    const message = errorMessage(rawError);
    // Log too, so the failure is still discoverable in the console/devtools.
    console.error("Global error safety net caught an error", rawError);

    // Coalesce into a single live overlay: a burst of failures must not stack
    // an unbounded pile of notices. The latest error wins.
    const existing = container.querySelector<HTMLDivElement>(
      `[id="${OVERLAY_ID}"]`,
    );
    if (existing) {
      const liveMessage = existing.querySelector<HTMLParagraphElement>(
        "[data-role='message']",
      );
      if (liveMessage) {
        liveMessage.textContent = message;
      }
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");
    styleOverlay(overlay);

    const title = document.createElement("p");
    title.textContent = "Something went wrong";
    title.style.margin = "0 0 6px";
    title.style.fontWeight = "600";

    const body = document.createElement("p");
    body.dataset.role = "message";
    body.textContent = message;
    body.style.margin = "0 0 10px";
    body.style.whiteSpace = "pre-wrap";
    body.style.wordBreak = "break-word";

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.dataset.action = "dismiss-global-error";
    dismiss.textContent = "Dismiss";
    dismiss.style.background = "#6d2b30";
    dismiss.style.border = "none";
    dismiss.style.borderRadius = "5px";
    dismiss.style.color = "#fbe8e8";
    dismiss.style.cursor = "pointer";
    dismiss.style.font = "inherit";
    dismiss.style.padding = "6px 12px";
    dismiss.addEventListener("click", () => overlay.remove());

    overlay.append(title, body, dismiss);
    container.append(overlay);
  };

  const onError = (event: ErrorEvent): void => {
    showNotice(event.error ?? event.message);
    // We have surfaced and recovered the error; stop it from propagating as an
    // uncaught failure (and silence the default console spam, which we replace
    // with our own contextual log).
    event.preventDefault();
  };

  const onRejection = (event: Event): void => {
    const reason = (event as Event & { reason?: unknown }).reason;
    showNotice(reason);
    event.preventDefault();
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    container.querySelector(`[id="${OVERLAY_ID}"]`)?.remove();
  };
}
