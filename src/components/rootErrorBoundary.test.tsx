// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

// Reproduces the production root composition from main.tsx: the WHOLE app is
// wrapped in a single root-level ErrorBoundary. A crash anywhere in the app
// tree (not only inside the git diff view) must render a recoverable fallback
// instead of unmounting everything to a blank screen.

function AppShell({ crash }: { crash: boolean }) {
  return (
    <main className="app-shell">
      <aside>sidebar</aside>
      <section>
        {crash ? <ExplodingPanel /> : <div data-testid="content">content</div>}
      </section>
    </main>
  );
}

function ExplodingPanel(): never {
  // Simulates a render crash OUTSIDE any inner per-view boundary - e.g. the
  // editor surface / tabs re-rendering after a git diff state change.
  throw new Error("a panel outside the diff view crashed during render");
}

describe("root ErrorBoundary around the whole app", () => {
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

  it("renders the app normally when nothing throws", () => {
    act(() => {
      root.render(
        <ErrorBoundary title="Codevo Editor hit an unexpected error">
          <AppShell crash={false} />
        </ErrorBoundary>,
      );
    });

    expect(host.querySelector('[data-testid="content"]')).not.toBeNull();
  });

  it("shows a recoverable fallback (never a blank screen) when any panel crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => {
      root.render(
        <ErrorBoundary title="Codevo Editor hit an unexpected error">
          <AppShell crash={true} />
        </ErrorBoundary>,
      );
    });

    // The root is NOT left blank: a recoverable alert is shown.
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain("Codevo Editor hit an unexpected error");
    expect(host.querySelector('[data-action="retry"]')).not.toBeNull();
    // Crucially, the host still has rendered content (it is not empty/blank).
    expect(host.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
