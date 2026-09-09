import {
  measureStartupShellPaint,
  startupShellPaintWasObserved,
  waitForStartupShellPaint,
} from "./startupShell";
import { createStartupErrorScreen } from "./startupErrorScreen";
import { applyBrowserStartupTheme } from "./startupTheme";

applyBrowserStartupTheme();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const appRoot = rootElement;
let startupComplete = false;

function showStartupError(error: unknown): void {
  appRoot.replaceChildren(createStartupErrorScreen(error));
}

// Before startup completes a failure means the app never mounted, so show the
// full-screen startup error. After startup we hand off to the global safety net
// (installed during bootstrap), which surfaces a dismissible recoverable notice
// for any error a React ErrorBoundary cannot catch (event handlers, async work,
// or a crash outside a boundary) WITHOUT ever blanking the running app.
window.addEventListener("error", (event) => {
  if (startupComplete) {
    return;
  }

  showStartupError(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  if (startupComplete) {
    return;
  }

  showStartupError(event.reason);
});

function reportStartupShellPaint(): void {
  performance.mark("codevo-startup-shell-painted");
  const measurement = measureStartupShellPaint(
    performance.now(),
    performance.getEntriesByType("paint"),
  );
  if (measurement === null) {
    return;
  }

  const paintEpochMs = performance.timeOrigin + measurement.rendererElapsedMs;
  if (!Number.isFinite(paintEpochMs)) {
    return;
  }

  void import("./startupTelemetry")
    .then(({ logStartupShellPaint }) => {
      logStartupShellPaint(measurement.rendererElapsedMs, paintEpochMs);
    })
    .catch(() => {
      // Telemetry is evidence-only and cannot own startup success.
    });
}

async function bootstrap(): Promise<void> {
  const startupShellPaintOutcome = await waitForStartupShellPaint();
  if (startupShellPaintWasObserved(startupShellPaintOutcome)) {
    reportStartupShellPaint();
  }

  const [
    { default: React },
    ReactDOM,
    { default: App },
    { ErrorBoundary },
    { installGlobalErrorSafetyNet },
    { strictModeEnabled },
  ] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./App"),
    import("./components/ErrorBoundary"),
    import("./infrastructure/globalErrorSafetyNet"),
    import("./perfLaneRenderMode"),
  ]);

  // Root-level boundary: ANY render/lifecycle crash anywhere in the app
  // (not just inside the git diff view) now renders a recoverable fallback
  // instead of unmounting the whole tree to a blank screen.
  const appTree = React.createElement(ErrorBoundary, {
    title: "Codevo Editor hit an unexpected error",
    children: React.createElement(App),
  });

  const rootTree = () => {
    if (!strictModeEnabled()) {
      return appTree;
    }

    return React.createElement(React.StrictMode, null, appTree);
  };

  ReactDOM.createRoot(appRoot).render(rootTree());
  startupComplete = true;
  // From here on, async/event crashes that escape React are caught globally and
  // shown as a dismissible notice rather than silently swallowed.
  installGlobalErrorSafetyNet();
}

void bootstrap().catch(showStartupError);
