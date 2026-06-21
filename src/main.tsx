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
  title.textContent = "Mockor Editor failed to start";
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

function handleGlobalError(error: unknown): void {
  if (startupComplete) {
    console.error("Unhandled Mockor Editor runtime error", error);
    return;
  }

  showStartupError(error);
}

window.addEventListener("error", (event) => {
  handleGlobalError(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  handleGlobalError(event.reason);
});

async function bootstrap(): Promise<void> {
  const [{ default: React }, ReactDOM, { default: App }, monacoEnvironment] =
    await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("./App"),
      import("./infrastructure/monacoEnvironment"),
    ]);

  monacoEnvironment.configureMonacoEnvironment();
  appRoot.replaceChildren();
  ReactDOM.createRoot(appRoot).render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(App),
    ),
  );
  startupComplete = true;
}

void bootstrap().catch(showStartupError);
