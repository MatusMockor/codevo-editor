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
          appTitle="Mockor Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={vi.fn()}
          onEditCommand={vi.fn()}
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
    expect(host.textContent).toContain("Mockor Editor");
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
          appTitle="Mockor Editor"
          commandContext={commandContext}
          commands={commands}
          onCommandError={vi.fn()}
          onEditCommand={vi.fn()}
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

  it("routes Edit menu commands through the active editor callback", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const execCommand = vi.fn();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const editCommand = vi.fn();

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Mockor Editor"
          commandContext={{ ...commandContext, hasActiveDocument: true }}
          commands={[]}
          onCommandError={vi.fn()}
          onEditCommand={editCommand}
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

    expect(editCommand).toHaveBeenCalledWith("undo");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("keeps Edit menu commands disabled when no editor target is available", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });
    const editCommand = vi.fn();

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Mockor Editor"
          commandContext={{ ...commandContext, hasActiveDocument: false }}
          commands={[]}
          onCommandError={vi.fn()}
          onEditCommand={editCommand}
          onQuitApplication={vi.fn()}
        />,
      );
    });

    await act(async () => {
      buttonWithText(host, "Edit").click();
    });
    const undo = buttonWithText(host, "Undo");

    expect(undo.disabled).toBe(true);

    await act(async () => {
      undo.click();
    });

    expect(editCommand).not.toHaveBeenCalled();
  });

  it("runs the custom window control actions through Tauri", async () => {
    vi.stubGlobal("navigator", {
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 X11 Linux x86_64",
    });

    await act(async () => {
      root.render(
        <WindowChrome
          appTitle="Mockor Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={vi.fn()}
          onEditCommand={vi.fn()}
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
          appTitle="Mockor Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={reportCommandError}
          onEditCommand={vi.fn()}
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
          appTitle="Mockor Editor"
          commandContext={{ ...commandContext, hasActiveDocument: true }}
          commands={[]}
          onCommandError={vi.fn()}
          onEditCommand={vi.fn()}
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
          appTitle="Mockor Editor"
          commandContext={commandContext}
          commands={[]}
          onCommandError={vi.fn()}
          onEditCommand={vi.fn()}
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
