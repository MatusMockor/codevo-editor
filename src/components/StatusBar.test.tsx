// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LARGE_SMART_DOCUMENT_STATUS_LABEL,
  LARGE_SMART_DOCUMENT_STATUS_TITLE,
} from "../domain/largeDocumentPolicy";
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

  it("renders the IDE activity chip as a button with a runtime tone dot and opens the runtime panel on click", async () => {
    const onOpenRuntimePanel = vi.fn();

    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Http/Controllers/CommentController.php"
          dirtyCount={0}
          ideActivityDetail={"PHPactor: running\nTS Server: stopped\nIndex: idle"}
          ideActivityLabel="IDE: PHPactor running"
          ideActivityState="active"
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          onOpenRuntimePanel={onOpenRuntimePanel}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel="laravel/laravel · PHP ^8.4"
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const activity = host.querySelector<HTMLButtonElement>(".status-ide-activity");

    expect(activity?.tagName).toBe("BUTTON");
    expect(
      activity?.querySelector(".status-ide-activity-dot")?.classList.contains(
        "active",
      ),
    ).toBe(true);
    expect(activity?.getAttribute("title")).toBe(
      "IDE: PHPactor running\n\nPHPactor: running\nTS Server: stopped\nIndex: idle",
    );

    await act(async () => {
      activity?.click();
    });

    expect(onOpenRuntimePanel).toHaveBeenCalledTimes(1);
  });

  it("shows a crashed tone on the IDE activity chip dot when a runtime crashes", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Service.php"
          dirtyCount={0}
          ideActivityLabel="IDE: PHPactor crashed"
          ideActivityState="problem"
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const dot = host.querySelector(".status-ide-activity-dot");

    expect(dot?.classList.contains("problem")).toBe(true);
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

  it("shows a passive large file mode chip with an explanatory tooltip", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/storage/logs/laravel.log"
          dirtyCount={0}
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          largeDocumentStatus={{
            label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
            title: LARGE_SMART_DOCUMENT_STATUS_TITLE,
          }}
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const chip = host.querySelector(".status-large-file-mode");

    expect(chip?.textContent).toBe(LARGE_SMART_DOCUMENT_STATUS_LABEL);
    expect(chip?.getAttribute("title")).toBe(
      LARGE_SMART_DOCUMENT_STATUS_TITLE,
    );
  });

  it("hides large file mode when its status bar item is toggled off", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/vendor/CarbonInterface.php"
          dirtyCount={0}
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          largeDocumentStatus={{
            label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
            title: LARGE_SMART_DOCUMENT_STATUS_TITLE,
          }}
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={{
            ...defaultStatusBarItemVisibility(),
            largeFileMode: false,
          }}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    expect(host.querySelector(".status-large-file-mode")).toBeNull();
  });

  it("lists large file mode in the status bar visibility menu", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/vendor/CarbonInterface.php"
          dirtyCount={0}
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const footer = host.querySelector<HTMLElement>("footer.status-bar");
    await act(async () => {
      footer?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });

    const menuLabels = Array.from(
      host.querySelectorAll<HTMLLabelElement>(".status-bar-menu-item"),
    ).map((label) => label.textContent);

    expect(menuLabels).toContain("Large file mode");
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

  it("shows the active editor cursor position as Ln/Col and goes to line on click", async () => {
    const onShowGoToLine = vi.fn();

    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Service.php"
          cursorPosition={{ column: 7, lineNumber: 42 }}
          dirtyCount={0}
          gitBranch={null}
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          onShowGitBranches={vi.fn()}
          onShowGoToLine={onShowGoToLine}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const cursor = host.querySelector<HTMLButtonElement>(
      ".status-cursor-position",
    );

    expect(cursor).not.toBeNull();
    expect(cursor?.textContent).toBe("Ln 42, Col 7");

    await act(async () => {
      cursor?.click();
    });

    expect(onShowGoToLine).toHaveBeenCalledTimes(1);
  });

  it("hides the cursor position when no editor position is known", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Service.php"
          cursorPosition={null}
          dirtyCount={0}
          gitBranch={null}
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    expect(host.querySelector(".status-cursor-position")).toBeNull();
  });

  it("hides the cursor position when its status bar item is toggled off", async () => {
    const statusBar = {
      ...defaultStatusBarItemVisibility(),
      cursorPosition: false,
    };

    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Service.php"
          cursorPosition={{ column: 7, lineNumber: 42 }}
          dirtyCount={0}
          gitBranch={null}
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={statusBar}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    expect(host.querySelector(".status-cursor-position")).toBeNull();
  });

  it("shows the active git branch and opens the branch panel on click", async () => {
    const onShowGitBranches = vi.fn();

    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Service.php"
          cursorPosition={null}
          dirtyCount={0}
          gitBranch="feature/status-bar"
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          onShowGitBranches={onShowGitBranches}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const branch = host.querySelector<HTMLButtonElement>(".status-git-branch");

    expect(branch).not.toBeNull();
    expect(branch?.textContent).toContain("feature/status-bar");

    await act(async () => {
      branch?.click();
    });

    expect(onShowGitBranches).toHaveBeenCalledTimes(1);
  });

  it("prefixes the git branch with a compact repository label for a nested-repo file", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/workbench/lcsk/attendance/src/A.php"
          cursorPosition={null}
          dirtyCount={0}
          gitBranch="develop"
          gitBranchRepositoryLabel="lcsk/attendance"
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          onShowGitBranches={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const branch = host.querySelector<HTMLButtonElement>(".status-git-branch");

    expect(branch?.textContent).toContain("lcsk/attendance");
    expect(branch?.textContent).toContain("develop");
    expect(branch?.title).toContain("lcsk/attendance");
    expect(branch?.title).toContain("develop");
  });

  it("hides the git branch when no branch is known", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Service.php"
          cursorPosition={null}
          dirtyCount={0}
          gitBranch={null}
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    expect(host.querySelector(".status-git-branch")).toBeNull();
  });

  it("hides the git branch when its status bar item is toggled off", async () => {
    const statusBar = {
      ...defaultStatusBarItemVisibility(),
      gitBranch: false,
    };

    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Service.php"
          cursorPosition={null}
          dirtyCount={0}
          gitBranch="main"
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={statusBar}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    expect(host.querySelector(".status-git-branch")).toBeNull();
  });

  it("offers cursor position and git branch in the visibility context menu", async () => {
    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Service.php"
          cursorPosition={{ column: 1, lineNumber: 1 }}
          dirtyCount={0}
          gitBranch="main"
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message={null}
          onChangeVisibility={vi.fn()}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const footer = host.querySelector("footer.status-bar");

    await act(async () => {
      footer?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    });

    const menu = host.querySelector(".status-bar-menu");

    expect(menu?.textContent).toContain("Cursor position");
    expect(menu?.textContent).toContain("Git branch");
  });

  it("toggles message visibility from the context menu without closing it", async () => {
    const onChangeVisibility = vi.fn();

    await act(async () => {
      root.render(
        <StatusBar
          activeLanguage="php"
          activePath="/workspace/app/Service.php"
          cursorPosition={{ column: 1, lineNumber: 1 }}
          dirtyCount={0}
          gitBranch="main"
          ideActivityLabel={null}
          ideActivityState={null}
          intelligenceMode="fullSmart"
          message="Saved"
          onChangeVisibility={onChangeVisibility}
          statusBar={defaultStatusBarItemVisibility()}
          workspaceInfoLabel={null}
          workspaceRoot="/workspace"
          workspaceTrustLabel="Trusted"
        />,
      );
    });

    const footer = host.querySelector("footer.status-bar");

    await act(async () => {
      footer?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    });

    const messageCheckbox = checkboxInStatusMenu("Messages");

    await act(async () => {
      messageCheckbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChangeVisibility).toHaveBeenCalledWith("message", false);
    expect(host.querySelector(".status-bar-menu")).not.toBeNull();

    await act(async () => {
      checkboxInStatusMenu("Unsaved files").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onChangeVisibility).toHaveBeenLastCalledWith("dirtyCount", false);
  });

  function renderStatusBar(message: string | null) {
    root.render(
      <StatusBar
        activeLanguage={null}
        activePath={null}
        dirtyCount={0}
        ideActivityLabel={null}
        ideActivityState={null}
        intelligenceMode="basic"
        message={message}
        onChangeVisibility={vi.fn()}
        statusBar={defaultStatusBarItemVisibility()}
        workspaceInfoLabel={null}
        workspaceRoot="/workspace"
        workspaceTrustLabel={null}
      />,
    );
  }

  it("shows a transient status message immediately", async () => {
    await act(async () => {
      renderStatusBar("Saved User.php");
    });

    expect(host.querySelector(".status-message")?.textContent).toBe(
      "Saved User.php",
    );
  });

  it("auto-dismisses a transient status message so it does not linger forever", async () => {
    vi.useFakeTimers();

    try {
      await act(async () => {
        renderStatusBar("Saved User.php");
      });

      expect(host.querySelector(".status-message")?.textContent).toBe(
        "Saved User.php",
      );

      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      expect(host.querySelector(".status-message")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the auto-dismiss timer when a new message replaces the previous one", async () => {
    vi.useFakeTimers();

    try {
      await act(async () => {
        renderStatusBar("Saved User.php");
      });

      await act(async () => {
        vi.advanceTimersByTime(4000);
      });

      await act(async () => {
        renderStatusBar("Stashed working tree changes");
      });

      // Only 2s have passed since the newer message replaced the old one (the
      // 4s elapsed before the swap must not count toward its timer), so it
      // should still be visible well past the first message's own deadline.
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      expect(host.querySelector(".status-message")?.textContent).toBe(
        "Stashed working tree changes",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the message immediately when the controller clears it", async () => {
    vi.useFakeTimers();

    try {
      await act(async () => {
        renderStatusBar("Saved User.php");
      });

      await act(async () => {
        renderStatusBar(null);
      });

      expect(host.querySelector(".status-message")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  function checkboxInStatusMenu(labelText: string): HTMLInputElement {
    const labels = Array.from(
      host.querySelectorAll<HTMLLabelElement>(".status-bar-menu-item"),
    );
    const label = labels.find((item) => item.textContent?.includes(labelText));
    const input = label?.querySelector<HTMLInputElement>("input");

    if (!input) {
      throw new Error(`${labelText} status bar menu checkbox was not rendered.`);
    }

    return input;
  }
});
