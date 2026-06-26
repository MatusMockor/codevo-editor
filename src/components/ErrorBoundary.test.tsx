// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

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
    const retry = host.querySelector<HTMLButtonElement>(
      'button[data-action="retry"]',
    );
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

    const retry = host.querySelector<HTMLButtonElement>(
      'button[data-action="retry"]',
    );

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
});
