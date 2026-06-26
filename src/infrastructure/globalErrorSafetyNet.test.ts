// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGlobalErrorSafetyNet } from "./globalErrorSafetyNet";

function dispatchError(message: string): void {
  window.dispatchEvent(
    new ErrorEvent("error", { error: new Error(message), message }),
  );
}

function dispatchRejection(reason: unknown): void {
  // jsdom does not synthesize PromiseRejectionEvent from real rejected
  // promises, so dispatch the event explicitly with the reason we want to
  // assert on. A plain Event with the field assigned matches what listeners
  // read in production.
  const event = new Event("unhandledrejection") as Event & {
    reason?: unknown;
  };
  event.reason = reason;
  window.dispatchEvent(event);
}

describe("installGlobalErrorSafetyNet", () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("shows a recoverable notice for an uncaught error instead of doing nothing", () => {
    uninstall = installGlobalErrorSafetyNet();

    dispatchError("boom from event handler");

    const overlay = document.querySelector('[role="alert"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("boom from event handler");
  });

  it("shows a recoverable notice for an unhandled promise rejection", () => {
    uninstall = installGlobalErrorSafetyNet();

    dispatchRejection(new Error("async diff load rejected"));

    const overlay = document.querySelector('[role="alert"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("async diff load rejected");
  });

  it("lets the user dismiss the notice so the app remains usable", () => {
    uninstall = installGlobalErrorSafetyNet();

    dispatchError("temporary glitch");
    const dismiss = document.querySelector<HTMLButtonElement>(
      '[data-action="dismiss-global-error"]',
    );
    expect(dismiss).not.toBeNull();

    dismiss?.click();

    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("coalesces repeated errors into a single live notice rather than stacking forever", () => {
    uninstall = installGlobalErrorSafetyNet();

    dispatchError("first");
    dispatchError("second");
    dispatchError("third");

    const overlays = document.querySelectorAll('[role="alert"]');
    expect(overlays).toHaveLength(1);
    // The latest error wins so the user sees the most recent failure.
    expect(overlays[0]?.textContent).toContain("third");
  });

  it("does nothing once uninstalled (no leaked listeners across reloads)", () => {
    uninstall = installGlobalErrorSafetyNet();
    uninstall();
    uninstall = null;

    // Once our net is gone, nothing should suppress the event. Swallow it here
    // (the production net would normally call preventDefault by rendering the
    // notice) so the dispatched error is not reported as a false-positive
    // unhandled error by the test runner.
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener("error", swallow);
    try {
      dispatchError("after uninstall");
    } finally {
      window.removeEventListener("error", swallow);
    }

    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
