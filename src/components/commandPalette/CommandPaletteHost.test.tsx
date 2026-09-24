// @vitest-environment jsdom

import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../../application/commandRegistry";
import { QuickInputCoordinator } from "../../application/quickInputCoordinator";
import { BrowserWorkbenchPrompter } from "../../infrastructure/browserWorkbenchPrompter";
import { QuickInputDialogHost } from "../QuickInputDialogHost";
import { __resetKeymapPlatformCacheForTests, defaultKeymapSettings } from "../../domain/keymap";
import { DEFAULT_APPEARANCE } from "../../domain/appearance";
import { mountUi, press, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { workbenchComposerPaletteModels } from "../../application/commandPalette/commandPaletteProvider";
import { CommandPaletteHost, type CommandPaletteHostProps } from "./CommandPaletteHost";

let ui: MountedUi | null = null;
beforeEach(() => {
  Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
  __resetKeymapPlatformCacheForTests();
});
afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
  __resetKeymapPlatformCacheForTests();
});

const context: CommandContext = {
  hasWorkspace: true,
  hasActiveDocument: false,
  activeDocumentDirty: false,
};

function command(id: string, title: string, run: Command["run"] = vi.fn()): Command {
  return { id, title, category: "Workbench", isEnabled: () => true, run };
}

function hostProps(overrides: Partial<CommandPaletteHostProps> = {}): CommandPaletteHostProps {
  return {
    paletteOpen: true,
    quickOpenOpen: false,
    initialQuery: "",
    setPaletteOpen: vi.fn(),
    setQuickOpenOpen: vi.fn(),
    commands: [
      command("agent.newThread", "New Thread"),
      command("workbench.openSettings", "Open Settings"),
      command("panel.showProblems", "Show Problems"),
    ],
    commandContext: context,
    reportCommandError: vi.fn(),
    keymap: defaultKeymapSettings("mac"),
    appearance: DEFAULT_APPEARANCE,
    saveAppearance: vi.fn(async () => undefined),
    workspaceRoot: "/u/orders-api",
    workspaceTabs: ["/u/orders-api"],
    activateWorkspaceTab: vi.fn(async () => undefined),
    nodePackageScripts: [],
    nodePackageScriptsTruncated: false,
    branchSource: null,
    fileSearch: {
      searchFiles: vi.fn(),
      searchFilesWithMetadata: vi.fn(async () => ({
        requestGeneration: "",
        results: [],
        truncated: false,
      })),
    },
    openSearchResult: vi.fn(async () => undefined),
    agentModeActive: false,
    quickOpen: null,
    ...overrides,
  };
}

function input(): HTMLInputElement {
  return document.querySelector(".cv-command-field input") as HTMLInputElement;
}

function type(value: string) {
  act(() => {
    const element = input();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CommandPaletteHost", () => {
  it("renders the root with actions for an empty query", () => {
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ initialQuery: "" })} />);
    type("");
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Command palette",
    );
    expect(document.querySelector(".cv-command-group__label")?.textContent).toBe("Actions");
  });

  it("jumps to the files page when @ is typed at the root", () => {
    const setPaletteOpen = vi.fn();
    const setQuickOpenOpen = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ setPaletteOpen, setQuickOpenOpen })} />);
    type("@");
    expect(setPaletteOpen).toHaveBeenCalledWith(false);
    expect(setQuickOpenOpen).toHaveBeenCalledWith(true);
  });

  it("closes itself when ⌘K is pressed inside the palette", () => {
    const setPaletteOpen = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ setPaletteOpen })} />);
    press(input(), "k", { metaKey: true });
    expect(setPaletteOpen).toHaveBeenCalledWith(false);
  });

  it("closes when the workspace root changes while open", () => {
    const setPaletteOpen = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ setPaletteOpen })} />);
    ui.render(
      <CommandPaletteHost {...hostProps({ setPaletteOpen, workspaceRoot: "/u/web-dashboard" })} />,
    );
    expect(setPaletteOpen).toHaveBeenCalledWith(false);
  });

  it("runs a pending command once and ignores Enter while it is pending", async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const setPaletteOpen = vi.fn();
    ui = mountUi();
    ui.render(
      <CommandPaletteHost
        {...hostProps({
          setPaletteOpen,
          initialQuery: "problems",
          commands: [command("panel.showProblems", "Show Problems", run)],
        })}
      />,
    );
    press(input(), "Enter");
    press(input(), "Enter");
    expect(run).toHaveBeenCalledTimes(1);
    expect(setPaletteOpen).not.toHaveBeenCalledWith(false);
    await act(async () => finish());
    expect(setPaletteOpen).toHaveBeenCalledWith(false);
  });

  it("reports a rejected command and stays open", async () => {
    const reportCommandError = vi.fn();
    const failing = command("panel.showProblems", "Show Problems", () =>
      Promise.reject(new Error("boom")),
    );
    const setPaletteOpen = vi.fn();
    ui = mountUi();
    ui.render(
      <CommandPaletteHost
        {...hostProps({
          reportCommandError,
          setPaletteOpen,
          initialQuery: "problems",
          commands: [failing],
        })}
      />,
    );
    await act(async () => press(input(), "Enter"));
    expect(reportCommandError).toHaveBeenCalledTimes(1);
    expect(setPaletteOpen).not.toHaveBeenCalledWith(false);
  });

  it("reports a stale selection instead of closing", async () => {
    const reportCommandError = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ reportCommandError, initialQuery: "" })} />);
    type("zzz-not-a-command");
    press(input(), "Enter");
    expect(reportCommandError).not.toHaveBeenCalled();
    expect(document.querySelector(".cv-command-empty")).not.toBeNull();
  });

  it("does not let a slow command from a closed session close the reopened palette", async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const setPaletteOpen = vi.fn();
    const props = hostProps({
      setPaletteOpen,
      initialQuery: "problems",
      commands: [command("panel.showProblems", "Show Problems", run)],
    });
    ui = mountUi();
    ui.render(<CommandPaletteHost {...props} />);
    press(input(), "Enter");
    expect(run).toHaveBeenCalledTimes(1);

    ui.render(<CommandPaletteHost {...props} paletteOpen={false} />);
    ui.render(<CommandPaletteHost {...props} />);
    await act(async () => finish());

    expect(setPaletteOpen).not.toHaveBeenCalledWith(false);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("offers Change model only in agent mode", () => {
    const unpublish = workbenchComposerPaletteModels.publish({
      options: [{ key: "m", group: "OpenAI", label: "GPT", current: true }],
      selectModel: () => true,
    });
    const titles = () =>
      [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? "");
    try {
      ui = mountUi();
      ui.render(<CommandPaletteHost {...hostProps({ initialQuery: "model" })} />);
      expect(titles().some((title) => title.includes("Change model"))).toBe(false);

      ui.render(
        <CommandPaletteHost {...hostProps({ initialQuery: "model", agentModeActive: true })} />,
      );
      expect(titles().some((title) => title.includes("Change model"))).toBe(true);
    } finally {
      act(() => unpublish());
    }
  });

  it("switches cheatsheet palette entries in place instead of opening and closing", async () => {
    const setPaletteOpen = vi.fn();
    const open = command("palette.open", "Open Command Palette");
    const shortcuts = command("palette.shortcuts", "Keyboard Shortcuts");
    ui = mountUi();
    ui.render(
      <CommandPaletteHost {...hostProps({ setPaletteOpen, commands: [open, shortcuts] })} />,
    );
    press(input(), "/", { metaKey: true });
    type("open command palette");
    await act(async () => press(input(), "Enter"));

    expect(open.run).not.toHaveBeenCalled();
    expect(setPaletteOpen).not.toHaveBeenCalledWith(false);
    expect(input().value).toBe("");
    expect(document.querySelector(".cv-command-group__label")?.textContent).toBe("Actions");
  });

  it("carries pasted @text to the files page query", () => {
    const setQuickOpenOpen = vi.fn();
    const onChangeQuery = vi.fn();
    ui = mountUi();
    ui.render(
      <CommandPaletteHost
        {...hostProps({
          setQuickOpenOpen,
          quickOpen: {
            isLoading: false,
            isTruncated: false,
            onChangeQuery,
            onOpen: vi.fn(),
            onOpenCurrentFileLocation: vi.fn(),
            query: "",
            request: { kind: "files", query: "" },
            results: [],
          },
        })}
      />,
    );
    type("@orders");

    expect(setQuickOpenOpen).toHaveBeenCalledWith(true);
    expect(onChangeQuery).toHaveBeenLastCalledWith("orders");
  });

  it("opens New File input from Enter and returns the chosen path to the command", async () => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    const coordinator = new QuickInputCoordinator();
    const prompter = new BrowserWorkbenchPrompter(coordinator);
    const chosenPaths: string[] = [];
    const newFile: Command = {
      category: "File",
      id: "file.new",
      isEnabled: () => true,
      run: async () => {
        const path = await prompter.prompt("New file path");
        if (path) chosenPaths.push(path);
      },
      title: "New File",
    };

    function Harness() {
      const [paletteOpen, setPaletteOpen] = useState(true);
      return (
        <>
          <CommandPaletteHost
            {...hostProps({
              commands: [newFile],
              initialQuery: "New File",
              paletteOpen,
              setPaletteOpen,
            })}
          />
          <QuickInputDialogHost coordinator={coordinator} workspaceScope="/workspace" />
        </>
      );
    }

    ui = mountUi();
    await act(async () => ui?.render(<Harness />));
    press(input(), "Enter");
    await settle();

    const quickInput = document.querySelector<HTMLInputElement>(".quick-input-dialog input");
    expect(quickInput).not.toBeNull();
    setValue(quickInput as HTMLInputElement, ".vscode/tasks.json");
    press(quickInput as HTMLInputElement, "Enter");
    await settle();

    expect(chosenPaths).toEqual([".vscode/tasks.json"]);
    expect(document.querySelector('[aria-label="Command palette"]')).toBeNull();
    expect(document.querySelector(".quick-input-dialog")).toBeNull();
    vi.restoreAllMocks();
  });
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
