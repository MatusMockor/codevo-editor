// @vitest-environment jsdom

import { act } from "react";
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
});
