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
    activeDocumentDirty: false,
    hasActiveDocument: false,
    hasWorkspace: false,
  };
  let host: HTMLDivElement;
  let originalExecCommandDescriptor: PropertyDescriptor | undefined;
  let restoreExecCommand = false;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    originalExecCommandDescriptor = undefined;
    restoreExecCommand = false;
    minimizeWindow.mockReset();
    toggleMaximizeWindow.mockReset();
    closeWindow.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    if (restoreExecCommand) {
      if (originalExecCommandDescriptor) {
        Object.defineProperty(
          document,
          "execCommand",
          originalExecCommandDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "execCommand");
      }
    }
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
        category: "Editor",
        id: "editor.closeTab",
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
    const openAppearanceSettings = vi.fn();
    const increaseFont = vi.fn();
    const decreaseFont = vi.fn();
    const resetFont = vi.fn();
    const toggleLigatures = vi.fn();
    const commands: Command[] = [
      command(
        "workbench.openAppearanceSettings",
        "Open Appearance Settings",
        openAppearanceSettings,
      ),
      command("editor.fontZoomIn", "Increase Editor Font Size", increaseFont),
      command("editor.fontZoomOut", "Decrease Editor Font Size", decreaseFont),
      command("editor.fontZoomReset", "Reset Editor Font Size", resetFont),
      command(
        "editor.toggleFontLigatures",
        "Toggle Editor Font Ligatures",
        toggleLigatures,
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
      buttonWithText(host, "Increase Editor Font Size").click();
    });
    await act(async () => {
      buttonWithText(host, "View").click();
    });
    await act(async () => {
      buttonWithText(host, "Decrease Editor Font Size").click();
    });
    await act(async () => {
      buttonWithText(host, "View").click();
    });
    await act(async () => {
      buttonWithText(host, "Reset Editor Font Size").click();
    });
    await act(async () => {
      buttonWithText(host, "View").click();
    });
    await act(async () => {
      buttonWithText(host, "Toggle Editor Font Ligatures").click();
    });
    await act(async () => {
      buttonWithText(host, "View").click();
    });
    await act(async () => {
      buttonWithText(host, "Open Appearance Settings").click();
    });

    expect(increaseFont).toHaveBeenCalledOnce();
    expect(decreaseFont).toHaveBeenCalledOnce();
    expect(resetFont).toHaveBeenCalledOnce();
    expect(toggleLigatures).toHaveBeenCalledOnce();
    expect(openAppearanceSettings).toHaveBeenCalledOnce();
  });

  it("runs enabled Edit menu commands from the registry", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const execCommand = vi.fn();
    originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "execCommand",
    );
    restoreExecCommand = true;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const undo = vi.fn();
    const selectAll = vi.fn();
    const commands: Command[] = [
      command("edit.undo", "Undo", undo),
      command("edit.selectAll", "Select All", selectAll),
    ];

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={{ ...commandContext, hasActiveDocument: true }}
          commands={commands}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "Edit").click();
    });
    await act(async () => {
      buttonWithText(host, "Undo").click();
    });
    await act(async () => {
      buttonWithText(host, "Edit").click();
    });
    await act(async () => {
      buttonWithText(host, "Select All").click();
    });

    expect(undo).toHaveBeenCalledOnce();
    expect(selectAll).toHaveBeenCalledOnce();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("keeps Edit menu commands disabled when the registry disables them", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const undoRun = vi.fn();
    const commands: Command[] = [
      {
        category: "Editor",
        id: "edit.undo",
        isEnabled: () => false,
        run: undoRun,
        shortcut: "Ctrl+Z",
        title: "Undo",
      },
    ];

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Codevo Editor"
          commandContext={{ ...commandContext, hasActiveDocument: false }}
          commands={commands}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "Edit").click();
    });
    const undo = buttonWithText(host, "Undo");
    const paste = buttonWithText(host, "Paste");

    expect(undo.disabled).toBe(true);
    expect(paste.disabled).toBe(true);

    await act(async () => {
      undo.click();
    });

    expect(undoRun).not.toHaveBeenCalled();
  });

  it("rechecks command enablement when a menu item is selected", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    let enabled = true;
    const undoRun = vi.fn();
    const reportCommandError = vi.fn();
    const commands: Command[] = [
      {
        category: "Editor",
        id: "edit.undo",
        isEnabled: () => enabled,
        run: undoRun,
        title: "Undo",
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
      buttonWithText(host, "Edit").click();
    });
    enabled = false;
    await act(async () => {
      buttonWithText(host, "Undo").click();
    });

    expect(host.querySelector(".window-menu-popover")).toBeNull();
    expect(undoRun).not.toHaveBeenCalled();
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
          commands={[command("editor.closeTab", "Close", run)]}
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
          commands={[command("editor.closeTab", "Close", run)]}
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
            command("editor.closeTab", "Close", closeRun),
            command("editor.save", "Save", saveRun),
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
      buttonWithText(host, "Save").click();
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
          commands={[command("editor.closeTab", "Close", run)]}
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
          commandContext={{ ...commandContext, hasActiveDocument: true }}
          commands={[]}
          onCommandError={vi.fn()}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "Edit").click();
    });

    const popover = host.querySelector(".window-menu-popover");

    expect(popover?.getAttribute("role")).toBeNull();
    expect(
      host.querySelector(".window-menu-item")?.getAttribute("role"),
    ).toBeNull();
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
      candidate.getAttribute("aria-label") === text ||
      candidate.textContent?.trim() === text,
  );

  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function command(
  id: string,
  title: string,
  run: () => void | Promise<void>,
): Command {
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
