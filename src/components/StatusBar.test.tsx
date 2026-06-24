// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStatusBarItemVisibility } from "../domain/settings";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
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
  });

  it("renders IDE engine and index as one activity item", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Http/Controllers/CommentController.php"
          dirtyCount={0}
          ideActivityLabel="IDE: PHPactor running · Index 608 files"
          ideActivityState="active"
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel="laravel/laravel · PHP ^8.4"
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const activity = host.querySelector(".status-ide-activity");

    expect(activity?.textContent).toBe("IDE: PHPactor running · Index 608 files");
    expect(activity?.classList.contains("active")).toBe(true);
    expect(host.textContent).not.toContain("PHPactor: running");
    expect(host.textContent).not.toContain("Index: 608 files");
  });

  it("shows aggregated error and warning counts and opens problems on click", async () => {
    const onShowProblems = vi.fn();

    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="typescript"
          activePath="/workspace/src/App.ts"
          dirtyCount={0}
          errorCount={5}
          warningCount={3}
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="basic"
          message={null}
          onChangeVisibility={vi.fn()}
          onShowProblems={onShowProblems}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const problems = host.querySelector<HTMLButtonElement>(
      ".status-problems",
    );

    expect(problems).not.toBeNull();
    expect(problems?.textContent).toContain("5");
    expect(problems?.textContent).toContain("3");

    await act(async () => {
      problems?.click();
    });

    expect(onShowProblems).toHaveBeenCalledTimes(1);
  });

  it("renders the problems item with zero counts as a no-problems affordance", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="typescript"
          activePath="/workspace/src/App.ts"
          dirtyCount={0}
          errorCount={0}
          warningCount={0}
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="basic"
          message={null}
          onChangeVisibility={vi.fn()}
          onShowProblems={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const problems = host.querySelector<HTMLButtonElement>(".status-problems");

    expect(problems).not.toBeNull();
    expect(problems?.textContent).toContain("0");
    expect(problems?.getAttribute("title")).toBe("No problems");
  });

  it("shows JS/TS project scope alongside per-project server activity", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="typescript"
          activePath="/workspace/src/App.ts"
          dirtyCount={0}
          ideActivityLabel="IDE: TS Server running for this project"
          ideActivityState="active"
          intelligenceMode="basic"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel="example-web · JS/TS · Inferred (partial) · npm"
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const activity = host.querySelector(".status-ide-activity");

    expect(activity?.textContent).toBe(
      "IDE: TS Server running for this project",
    );
    expect(activity?.getAttribute("title")).toBe(
      "IDE: TS Server running for this project",
    );
    expect(host.textContent).toContain(
      "example-web · JS/TS · Inferred (partial) · npm",
    );
  });

  it("does not re-render when the parent re-renders with identical props", async () => {
    // The footer reads `statusBar.activePath` during every render, so a getter
    // spy on that property counts how often the memoized footer renders.
    const statusBar = defaultStatusBarItemVisibility();
    let activePathReads = 0;
    const realActivePath = statusBar.activePath;
    Object.defineProperty(statusBar, "activePath", {
      configurable: true,
      enumerable: true,
      get() {
        activePathReads += 1;
        return realActivePath;
      },
    });

    const stableProps: React.ComponentProps<typeof StatusBar> = {
      activeLanguage: "php",
      activePath: "/workspace/app/Service.php",
      dirtyCount: 0,
      ideActivityLabel: null,
      ideActivityState: null,
      intelligenceMode: "fullSmart",
      message: null,
      onChangeVisibility: vi.fn(),
      onShowProblems: vi.fn(),
      statusBar,
      workspaceInfoLabel: null,
      workspaceRoot: "/workspace",
      workspaceTrustLabel: "Trusted",
    };

    let forceParentRender: (value: number) => void = () => undefined;

    function Parent() {
      const [, setTick] = useState(0);
      forceParentRender = setTick;
      return <StatusBar {...stableProps} />;
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    const readsAfterMount = activePathReads;
    expect(readsAfterMount).toBeGreaterThan(0);

    await act(async () => {
      forceParentRender(1);
      await Promise.resolve();
    });

    // React.memo prevents the footer from re-rendering when every prop is
    // referentially unchanged, so `statusBar.activePath` is never read again.
    expect(activePathReads).toBe(readsAfterMount);
  });
});
