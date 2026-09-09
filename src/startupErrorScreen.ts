export const STARTUP_ERROR_TITLE = "Codevo Editor failed to start";
export const STARTUP_ERROR_CLASS = "startup-error";
export const STARTUP_ERROR_TITLE_CLASS = "startup-error__title";
export const STARTUP_ERROR_DETAILS_CLASS = "startup-error__details";

export function startupErrorMessage(error: unknown): string {
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

export function createStartupErrorScreen(error: unknown): HTMLElement {
  const container = document.createElement("main");
  container.className = STARTUP_ERROR_CLASS;

  const title = document.createElement("h1");
  title.className = STARTUP_ERROR_TITLE_CLASS;
  title.textContent = STARTUP_ERROR_TITLE;

  const details = document.createElement("pre");
  details.className = STARTUP_ERROR_DETAILS_CLASS;
  details.textContent = startupErrorMessage(error);

  container.append(title, details);
  return container;
}
