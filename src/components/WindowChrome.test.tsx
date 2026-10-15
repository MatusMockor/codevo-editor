// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../application/commandRegistry";
import { WindowChrome } from "./WindowChrome";

const minimizeWindow = vi.fn();
const toggleMaximizeWindow = vi.fn();
const closeWindow = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: closeWindow,
    minimize: minimizeWindow,
    toggleMaximize: toggleMaximizeWindow,
  }),
}));

describe("WindowChrome", () => {
  const commandContext: CommandContext = {
    hasWorkspace: false,
  };
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    minimizeWindow.mockReset();
    toggleMaximizeWindow.mockReset();
    closeWindow.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("renders an app-themed draggable title bar with custom controls on Linux", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    const chrome = host.querySelector<HTMLElement>(".window-chrome");

    expect(chrome).not.toBeNull();
    expect(chrome?.getAttribute("data-tauri-drag-region")).toBe("");
    expect(chrome?.dataset.platform).toBe("linux");
    expect(host.querySelector(".window-menu-bar")).not.toBeNull();
    expect(host.querySelectorAll(".window-control")).toHaveLength(3);
    expect(host.textContent).toContain("Codevo Editor");
  });

  it("runs enabled File menu commands from the custom menu", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const closeTab = vi.fn();
    const commands: Command[] = [
      {
        category: "Workbench",
        id: "workbench.closeActive",
        isEnabled: () => true,
        run: closeTab,
        shortcut: "Ctrl+W",
        title: "Close",
      },
    ];

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={commands}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    await act(async () => {
      buttonWithText(host, "Close").click();
    });

    expect(closeTab).toHaveBeenCalledOnce();
    expect(host.querySelector(".window-menu-popover")).toBeNull();
  });

  it("runs enabled View menu commands from the custom menu", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    const resetZoom = vi.fn();
    const openAppearanceSettings = vi.fn();
    const commands: Command[] = [
      command("workbench.zoomIn", "Zoom In", zoomIn),
      command("workbench.zoomOut", "Zoom Out", zoomOut),
      command("workbench.zoomReset", "Reset Zoom", resetZoom),
      command(
        "workbench.openAppearanceSettings",
        "Open Appearance Settings",
        openAppearanceSettings,
      ),
    ];

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={commands}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "View").click();
    });
    await act(async () => {
      buttonWithText(host, "Zoom In").click();
    });
    await act(async () => {
      buttonWithText(host, "View").click();
    });
    await act(async () => {
      buttonWithText(host, "Zoom Out").click();
    });
    await act(async () => {
      buttonWithText(host, "View").click();
    });
    await act(async () => {
      buttonWithText(host, "Reset Zoom").click();
    });
    await act(async () => {
      buttonWithText(host, "View").click();
    });
    await act(async () => {
      buttonWithText(host, "Open Appearance Settings").click();
    });

    expect(zoomIn).toHaveBeenCalledOnce();
    expect(zoomOut).toHaveBeenCalledOnce();
    expect(resetZoom).toHaveBeenCalledOnce();
    expect(openAppearanceSettings).toHaveBeenCalledOnce();
  });

  it("offers only the File and View menus with app-level items", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    expect(
      [...host.querySelectorAll(".window-menu-button")].map((button) => button.textContent),
    ).toEqual(["File", "View"]);
    await act(async () => {
      buttonWithText(host, "File").click();
    });
    expect(menuItemLabels(host)).toEqual(["Go to File", "Close", "Quit Codevo Editor"]);
    await act(async () => {
      buttonWithText(host, "View").click();
    });
    expect(menuItemLabels(host)).toEqual([
      "Zoom In",
      "Zoom Out",
      "Reset Zoom",
      "Open Appearance Settings",
    ]);
  });

  it("keeps File menu commands disabled when the registry disables or lacks them", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const quickOpenRun = vi.fn();
    const commands: Command[] = [
      {
        category: "File",
        id: "file.quickOpen",
        isEnabled: () => false,
        run: quickOpenRun,
        shortcut: "Ctrl+P",
        title: "Go to File",
      },
    ];

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={commands}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    const quickOpen = buttonWithText(host, "Go to File");
    const close = buttonWithText(host, "Close");

    expect(quickOpen.disabled).toBe(true);
    expect(close.disabled).toBe(true);

    await act(async () => {
      quickOpen.click();
    });

    expect(quickOpenRun).not.toHaveBeenCalled();
  });

  it("rechecks command enablement when a menu item is selected", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    let enabled = true;
    const quickOpenRun = vi.fn();
    const reportCommandError = vi.fn();
    const commands: Command[] = [
      {
        category: "File",
        id: "file.quickOpen",
        isEnabled: () => enabled,
        run: quickOpenRun,
        title: "Go to File",
      },
    ];

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={commands}
          onCommandError={reportCommandError}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    enabled = false;
    await act(async () => {
      buttonWithText(host, "Go to File").click();
    });

    expect(host.querySelector(".window-menu-popover")).toBeNull();
    expect(quickOpenRun).not.toHaveBeenCalled();
    expect(reportCommandError).not.toHaveBeenCalled();
  });

  it("closes the menu before awaiting a command and reports async rejection", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const error = new Error("Async command failed");
    let rejectCommand: (error: Error) => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCommand = reject;
        }),
    );
    const reportCommandError = vi.fn();

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[command("workbench.closeActive", "Close", run)]}
          onCommandError={reportCommandError}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    act(() => {
      buttonWithText(host, "Close").click();
    });

    expect(host.querySelector(".window-menu-popover")).toBeNull();
    expect(run).toHaveBeenCalledOnce();

    await act(async () => {
      rejectCommand(error);
      await Promise.resolve();
    });

    expect(reportCommandError).toHaveBeenCalledOnce();
    expect(reportCommandError).toHaveBeenCalledWith(error);
  });

  it("reports synchronous command rejection without invoking twice", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const error = new Error("Sync command failed");
    const run = vi.fn(() => {
      throw error;
    });
    const reportCommandError = vi.fn();

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[command("workbench.closeActive", "Close", run)]}
          onCommandError={reportCommandError}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    await act(async () => {
      buttonWithText(host, "Close").click();
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledOnce();
    expect(reportCommandError).toHaveBeenCalledOnce();
    expect(reportCommandError).toHaveBeenCalledWith(error);
  });

  it("ignores a reopened duplicate while allowing an unrelated command", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const closePending = deferred();
    const closeRun = vi.fn(() => closePending.promise);
    const saveRun = vi.fn();

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[
            command("workbench.closeActive", "Close", closeRun),
            command("file.quickOpen", "Go to File", saveRun),
          ]}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    act(() => {
      buttonWithText(host, "Close").click();
    });
    await act(async () => {
      buttonWithText(host, "File").click();
    });
    act(() => {
      buttonWithText(host, "Close").click();
    });

    expect(closeRun).toHaveBeenCalledOnce();

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    await act(async () => {
      buttonWithText(host, "Go to File").click();
    });

    expect(saveRun).toHaveBeenCalledOnce();

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    await act(async () => {
      closePending.resolve();
      await closePending.promise;
    });

    expect(host.querySelector(".window-menu-popover")).not.toBeNull();
    expect(closeRun).toHaveBeenCalledOnce();
  });

  it("releases the pending command gate after success and rejection", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const firstRun = deferred();
    const secondRun = deferred();
    const thirdRun = deferred();
    const error = new Error("Deferred command failed");
    const run = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstRun.promise)
      .mockReturnValueOnce(secondRun.promise)
      .mockReturnValueOnce(thirdRun.promise);
    const reportCommandError = vi.fn();

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[command("workbench.closeActive", "Close", run)]}
          onCommandError={reportCommandError}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    act(() => {
      buttonWithText(host, "Close").click();
    });
    await act(async () => {
      firstRun.resolve();
      await firstRun.promise;
    });

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    act(() => {
      buttonWithText(host, "Close").click();
    });

    expect(run).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondRun.reject(error);
      try {
        await secondRun.promise;
      } catch {
        // The component reports the rejection through onCommandError.
      }
    });

    expect(reportCommandError).toHaveBeenCalledWith(error);

    await act(async () => {
      buttonWithText(host, "File").click();
    });
    act(() => {
      buttonWithText(host, "Close").click();
    });

    expect(run).toHaveBeenCalledTimes(3);

    await act(async () => {
      thirdRun.resolve();
      await thirdRun.promise;
    });
  });

  it("runs the custom window control actions through Tauri", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "Minimize window").click();
      await Promise.resolve();
    });
    await act(async () => {
      buttonWithText(host, "Maximize window").click();
      await Promise.resolve();
    });
    await act(async () => {
      buttonWithText(host, "Close window").click();
      await Promise.resolve();
    });

    expect(minimizeWindow).toHaveBeenCalledOnce();
    expect(toggleMaximizeWindow).toHaveBeenCalledOnce();
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("reports custom window control errors", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const error = new Error("No window");
    const reportCommandError = vi.fn();
    minimizeWindow.mockRejectedValueOnce(error);

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={reportCommandError}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "Minimize window").click();
      await Promise.resolve();
    });

    expect(reportCommandError).toHaveBeenCalledWith(error);
  });

  it("uses disclosure semantics instead of an incomplete ARIA menu pattern", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "View").click();
    });

    const popover = host.querySelector(".window-menu-popover");

    expect(popover?.getAttribute("role")).toBeNull();
    expect(host.querySelector(".window-menu-item")?.getAttribute("role")).toBeNull();
  });

  it("leaves macOS traffic-light controls native", async () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 Macintosh",
    });

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    const chrome = host.querySelector<HTMLElement>(".window-chrome");

    expect(chrome?.dataset.platform).toBe("mac");
    expect(host.querySelector(".window-menu-bar")).toBeNull();
    expect(host.querySelector(".window-control")).toBeNull();
    expect(host.querySelector(".window-native-control-space")).not.toBeNull();
  });
});

function buttonWithText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === text || candidate.textContent?.trim() === text,
  );

  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function menuItemLabels(host: HTMLElement): (string | null)[] {
  return [...host.querySelectorAll(".window-menu-item")].map((item) =>
    item.getAttribute("aria-label"),
  );
}

function command(id: string, title: string, run: () => void | Promise<void>): Command {
  return {
    category: "Test",
    id,
    isEnabled: () => true,
    run,
    title,
  };
}

function deferred() {
  let reject: (error: Error) => void = () => undefined;
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });

  return { promise, reject, resolve };
}
