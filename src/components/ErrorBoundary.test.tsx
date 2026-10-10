// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, type ErrorBoundaryFailure } from "./ErrorBoundary";
import { captureConsoleErrors, expectOnlyCaughtErrorReports } from "./errorBoundaryTestSupport";

function Boom(): never {
  throw new Error("render exploded");
}

function Safe() {
  return <div data-testid="safe-child">safe</div>;
}

describe("ErrorBoundary", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("renders children when nothing throws", () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Safe />
        </ErrorBoundary>,
      );
    });

    expect(host.querySelector('[data-testid="safe-child"]')).not.toBeNull();
  });

  it("renders fallback UI instead of blanking when a child throws while rendering", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    });

    // The whole subtree must NOT be left blank: a recoverable notice renders.
    expect(host.textContent).toContain("Something went wrong");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="safe-child"]')).toBeNull();
  });

  it("recovers and re-renders children after pressing Try again", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    let shouldThrow = true;

    function Maybe() {
      if (shouldThrow) {
        throw new Error("first render explodes");
      }

      return <div data-testid="recovered">ok</div>;
    }

    act(() => {
      root.render(
        <ErrorBoundary>
          <Maybe />
        </ErrorBoundary>,
      );
    });

    expect(host.querySelector('[role="alert"]')).not.toBeNull();

    shouldThrow = false;
    const retry = host.querySelector<HTMLButtonElement>('button[data-action="retry"]');
    expect(retry).not.toBeNull();

    act(() => {
      retry?.click();
    });

    expect(host.querySelector('[data-testid="recovered"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("invokes the onReset callback when retrying", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onReset = vi.fn();

    act(() => {
      root.render(
        <ErrorBoundary onReset={onReset}>
          <Boom />
        </ErrorBoundary>,
      );
    });

    const retry = host.querySelector<HTMLButtonElement>('button[data-action="retry"]');

    act(() => {
      retry?.click();
    });

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("uses a custom title when provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => {
      root.render(
        <ErrorBoundary title="Could not render the diff">
          <Boom />
        </ErrorBoundary>,
      );
    });

    expect(host.textContent).toContain("Could not render the diff");
  });

  it("hands the failure to renderFallback instead of rendering the default notice", () => {
    const consoleError = captureConsoleErrors();
    const failures: ErrorBoundaryFailure[] = [];

    act(() => {
      root.render(
        <ErrorBoundary
          renderFallback={(failure) => {
            failures.push(failure);
            return <div data-testid="custom-fallback">custom</div>;
          }}
          title="Unused title"
        >
          <Boom />
        </ErrorBoundary>,
      );
    });

    const settled = failures[failures.length - 1];
    expect(host.querySelector('[data-testid="custom-fallback"]')).not.toBeNull();
    expect(host.querySelector(".error-boundary-fallback")).toBeNull();
    expect(host.textContent).toBe("custom");
    expect(failures[0]?.componentStack).toBeNull();
    expect(settled?.error.message).toBe("render exploded");
    expect(settled?.componentStack).toMatch(/\bat Boom\b/);
    expect(consoleError).toHaveBeenCalledWith(
      "ErrorBoundary caught a render error",
      settled?.error,
      expect.objectContaining({ componentStack: settled?.componentStack }),
    );
    expectOnlyCaughtErrorReports(consoleError, 1);
  });

  it("retries through renderFallback and forgets the previous component stack", () => {
    const consoleError = captureConsoleErrors();
    const onReset = vi.fn();
    const failures: ErrorBoundaryFailure[] = [];
    let cause: string | null = "first failure";

    function Maybe() {
      if (cause !== null) {
        throw new Error(cause);
      }

      return <div data-testid="recovered">ok</div>;
    }

    function retryButton(): HTMLButtonElement | null {
      return host.querySelector<HTMLButtonElement>('button[data-action="custom-retry"]');
    }

    act(() => {
      root.render(
        <ErrorBoundary
          onReset={onReset}
          renderFallback={(failure) => {
            failures.push(failure);
            return (
              <button data-action="custom-retry" onClick={failure.retry} type="button">
                retry
              </button>
            );
          }}
        >
          <Maybe />
        </ErrorBoundary>,
      );
    });
    expect(retryButton()).not.toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 1);

    cause = "second failure";
    failures.length = 0;
    act(() => {
      retryButton()?.click();
    });

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(new Set(failures.map((failure) => failure.error.message))).toEqual(
      new Set(["second failure"]),
    );
    expect(failures[0]?.componentStack).toBeNull();
    expect(failures[failures.length - 1]?.componentStack).toMatch(/\bat Maybe\b/);
    expectOnlyCaughtErrorReports(consoleError, 2);

    cause = null;
    act(() => {
      retryButton()?.click();
    });

    expect(onReset).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="recovered"]')).not.toBeNull();
    expect(retryButton()).toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 2);
  });

  it("clears a renderFallback failure when a reset key changes", () => {
    const consoleError = captureConsoleErrors();
    let shouldThrow = true;

    function Maybe() {
      if (shouldThrow) {
        throw new Error("selected input explodes");
      }

      return <div data-testid="recovered">ok</div>;
    }

    function view(selected: string) {
      return (
        <ErrorBoundary
          renderFallback={() => <div data-testid="custom-fallback">custom</div>}
          resetKeys={[selected]}
        >
          <Maybe />
        </ErrorBoundary>
      );
    }

    act(() => {
      root.render(view("a"));
    });
    shouldThrow = false;
    act(() => {
      root.render(view("a"));
    });
    expect(host.querySelector('[data-testid="custom-fallback"]')).not.toBeNull();

    act(() => {
      root.render(view("b"));
    });

    expect(host.querySelector('[data-testid="recovered"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="custom-fallback"]')).toBeNull();
    expectOnlyCaughtErrorReports(consoleError, 1);
  });
});
