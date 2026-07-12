const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const appRoot = rootElement;
let startupComplete = false;

function startupErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function showStartupError(error: unknown): void {
  appRoot.replaceChildren();
  const container = document.createElement("main");
  container.style.background = "#111418";
  container.style.boxSizing = "border-box";
  container.style.color = "#d5d9e2";
  container.style.font = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  container.style.minHeight = "100vh";
  container.style.padding = "28px";

  const title = document.createElement("h1");
  title.textContent = "Codevo Editor failed to start";
  title.style.fontSize = "18px";
  title.style.margin = "0 0 14px";

  const details = document.createElement("pre");
  details.textContent = startupErrorMessage(error);
  details.style.background = "#0b0d10";
  details.style.border = "1px solid #2a303a";
  details.style.borderRadius = "6px";
  details.style.color = "#f3b4b4";
  details.style.margin = "0";
  details.style.overflow = "auto";
  details.style.padding = "16px";
  details.style.whiteSpace = "pre-wrap";

  container.append(title, details);
  appRoot.append(container);
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

async function bootstrap(): Promise<void> {
  const [
    { default: React },
    ReactDOM,
    { default: App },
    { ErrorBoundary },
    monacoEnvironment,
    { installGlobalErrorSafetyNet },
  ] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./App"),
    import("./components/ErrorBoundary"),
    import("./infrastructure/monacoEnvironment"),
    import("./infrastructure/globalErrorSafetyNet"),
  ]);

  monacoEnvironment.configureMonacoEnvironment();
  appRoot.replaceChildren();
  ReactDOM.createRoot(appRoot).render(
    React.createElement(
      React.StrictMode,
      null,
      // Root-level boundary: ANY render/lifecycle crash anywhere in the app
      // (not just inside the git diff view) now renders a recoverable fallback
      // instead of unmounting the whole tree to a blank screen.
      React.createElement(ErrorBoundary, {
        title: "Codevo Editor hit an unexpected error",
        children: React.createElement(App),
      }),
    ),
  );
  startupComplete = true;
  // From here on, async/event crashes that escape React are caught globally and
  // shown as a dismissible notice rather than silently swallowed.
  installGlobalErrorSafetyNet();
}

void bootstrap().catch(showStartupError);
