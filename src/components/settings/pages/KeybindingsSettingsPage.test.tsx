// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultKeymapSettings, keymapCommands, type KeymapPlatform } from "../../../domain/keymap";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
} from "../../../domain/settings";
import type {
  SettingsDraftActions,
  SettingsEnvironment,
  SettingsSaveInput,
} from "../settingsPageProps";
import { KeybindingsSettingsPage } from "./KeybindingsSettingsPage";
import { keybindingCountLabel, keybindingStrokes } from "./keybindingsPresentation";

const env: SettingsEnvironment = {
  appUpdater: null,
  gitDetectedRepositoryMappings: [],
  hasWorkspace: true,
  phpTools: null,
  providerManagement: null,
  providerSignIn: null,
  systemFontGateway: { listMonospaceFontFamilies: async () => [] },
  workspaceDescriptor: null,
  workspaceRoot: "/workspace",
  onCopyInstallCommand: () => undefined,
  onOpenJavaScriptTypeScriptServiceLog: async () => undefined,
  onOpenNodeLaunchConfigurations: () => undefined,
  onRestartJavaScriptTypeScriptService: async () => undefined,
};

interface HarnessProps {
  readonly appSettings: AppSettings;
  readonly platform: KeymapPlatform;
  onSave(input: SettingsSaveInput): void;
}

function Harness({ appSettings, onSave, platform }: HarnessProps) {
  const [settings, setSettings] = useState(appSettings);
  const settingsRef = useRef(settings);
  const workspaceSettings = defaultWorkspaceSettings();
  const actions: SettingsDraftActions = {
    publishAppSettings: (next) => {
      settingsRef.current = next;
      setSettings(next);
    },
    save: (input) =>
      onSave({
        appSettings: input.appSettings ?? settingsRef.current,
        trusted: true,
        workspaceSettings,
      }),
    updateAppSettings: (next) => {
      settingsRef.current = next;
      setSettings(next);
      onSave({ appSettings: next, trusted: true, workspaceSettings });
    },
    updateIgnorePatternsText: () => undefined,
    updateTrusted: () => undefined,
    updateWorkspaceSettings: () => undefined,
  };

  return (
    <KeybindingsSettingsPage
      actions={actions}
      draft={{
        appSettings: settings,
        ignorePatternsText: "",
        trusted: true,
        workspaceSettings,
      }}
      env={env}
      platform={platform}
    />
  );
}

describe("KeybindingsSettingsPage", () => {
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

  it("groups every command and marks reserved bindings read-only", async () => {
    await render({ keymap: defaultKeymapSettings("mac") }, "mac");

    const categories = new Set(keymapCommands.map((command) => command.category));

    expect(host.querySelectorAll(".settings-kb__row")).toHaveLength(keymapCommands.length);
    expect(host.querySelectorAll(".settings-kb__cat")).toHaveLength(categories.size);
    expect(host.textContent).toContain("editor.save");
    expect(host.textContent).toContain("editor.nextRecentlyUsedEditor");

    expect(whenCell("editor.nextRecentlyUsedEditor")).toBe("Reserved");
    expect(editButton("editor.nextRecentlyUsedEditor").disabled).toBe(true);
    expect(editButton("editor.previousRecentlyUsedEditor").disabled).toBe(true);
    expect(whenCell("editor.save")).toBe("Always");
    expect(editButton("editor.save").disabled).toBe(false);
  });

  it("reports the visible binding count", async () => {
    await render({ keymap: defaultKeymapSettings("mac") }, "mac");

    expect(host.textContent).toContain(`${keymapCommands.length} bindings`);
  });

  it("renders Linux key chips as modifier names", async () => {
    await render({ keymap: defaultKeymapSettings("linux") }, "linux");

    expect(chipsFor("editor.save")).toEqual(["Ctrl", "S"]);
  });

  it("renders macOS key chips as modifier glyphs", async () => {
    await render({ keymap: defaultKeymapSettings("mac") }, "mac");

    expect(chipsFor("editor.save")).toEqual(["⌘", "S"]);
  });

  it("shows a chord as two strokes joined by then", async () => {
    await render({ keymap: { ...defaultKeymapSettings("mac"), "editor.save": "Cmd+K S" } }, "mac");

    expect(chipsFor("editor.save")).toEqual(["⌘", "K", "S"]);
    expect(keyCell("editor.save")?.textContent).toContain("then");
  });

  it("distinguishes menus for commands with duplicate visible labels", async () => {
    await render(
      {
        keymap: {
          ...defaultKeymapSettings("mac"),
          "javascript.sortImports": "Cmd+Alt+J",
          "typescript.sortImports": "Cmd+Alt+T",
        },
      },
      "mac",
    );

    expect(menuButton("typescript.sortImports")).not.toBe(menuButton("javascript.sortImports"));
  });

  it("resets one customized shortcut to its platform default", async () => {
    const onSave = vi.fn();
    const keymap = {
      ...defaultKeymapSettings("linux"),
      "editor.closeTab": "Ctrl+Alt+W",
      "editor.save": "F12",
    };

    await render({ keymap }, "linux", onSave);

    await click(menuButton("editor.save"));
    await click(actionButton("Reset Save File (editor.save) to default"));

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), keymap: { ...keymap, "editor.save": "Ctrl+S" } },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
    expect(chipsFor("editor.save")).toEqual(["Ctrl", "S"]);
  });

  it("unbinds a shortcut from the row menu", async () => {
    const onSave = vi.fn();
    const keymap = defaultKeymapSettings("mac");

    await render({ keymap }, "mac", onSave);

    await click(menuButton("editor.save"));
    await click(actionButton("Unbind Save File (editor.save)"));

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), keymap: { ...keymap, "editor.save": "" } },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
    expect(keyCell("editor.save")?.textContent).toContain("Unbound");
  });

  it("filters bindings by label, id, category and shortcut", async () => {
    await render(
      {
        keymap: {
          ...defaultKeymapSettings("mac"),
          "editor.formatDocument": "",
          "editor.save": "Cmd+Alt+Shift+S",
        },
      },
      "mac",
    );

    await type(filterInput(), "Save File");
    expect(host.querySelectorAll(".settings-kb__row")).toHaveLength(1);
    expect(host.textContent).toContain("1 binding");

    await type(filterInput(), "editor.save");
    expect(host.querySelector(".settings-kb__row")?.textContent).toContain("Save File");

    await type(filterInput(), "git");
    const byCategory = [...host.querySelectorAll(".settings-kb__row")];
    expect(byCategory.length).toBeGreaterThan(0);
    expect(byCategory.every((row) => row.textContent?.toLowerCase().includes("git"))).toBe(true);

    await type(filterInput(), "alt+shift+s");
    expect(host.querySelectorAll(".settings-kb__row")).toHaveLength(1);

    await type(filterInput(), "shift+alt+f");
    expect(
      [...host.querySelectorAll(".settings-kb__row")].some((row) =>
        row.textContent?.includes("Format Document"),
      ),
    ).toBe(true);

    await type(filterInput(), "");
    expect(host.querySelectorAll(".settings-kb__row")).toHaveLength(keymapCommands.length);
  });

  it("reports an empty filter result", async () => {
    await render({ keymap: defaultKeymapSettings("mac") }, "mac");

    await type(filterInput(), "no-such-command-anywhere");

    expect(host.querySelector(".settings-kb__empty")?.textContent).toBe("No matching shortcuts");
    expect(host.textContent).toContain("0 bindings");
  });

  it("captures a shortcut from a real key press and persists it on save", async () => {
    const onSave = vi.fn();
    const keymap = defaultKeymapSettings("mac");

    await render({ keymap }, "mac", onSave);

    await click(editButton("editor.closeTab"));
    await press("editor.closeTab", { key: "w", metaKey: true, shiftKey: true });

    expect(recordingInput("editor.closeTab").value).toBe("Cmd+Shift+W");
    expect(onSave).not.toHaveBeenCalled();

    await click(saveButton("editor.closeTab"));

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        keymap: { ...keymap, "editor.closeTab": "Cmd+Shift+W" },
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("captures and persists a complete two-stroke chord without bubbling", async () => {
    const onSave = vi.fn();
    const onWindowKeyDown = vi.fn();
    const keymap = defaultKeymapSettings("mac");
    window.addEventListener("keydown", onWindowKeyDown);

    await render({ keymap }, "mac", onSave);

    await click(editButton("editor.save"));
    await press("editor.save", { key: "k", metaKey: true });
    expect(recordingInput("editor.save").value).toBe("Cmd+K");

    await press("editor.save", { key: "s" });
    expect(recordingInput("editor.save").value).toBe("Cmd+K S");

    await click(saveButton("editor.save"));

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), keymap: { ...keymap, "editor.save": "Cmd+K S" } },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("captures a safe bare function key as the first stroke", async () => {
    const onSave = vi.fn();
    const keymap = defaultKeymapSettings("mac");

    await render({ keymap }, "mac", onSave);

    await click(editButton("editor.save"));
    await press("editor.save", { key: "F8" });
    await click(saveButton("editor.save"));

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), keymap: { ...keymap, "editor.save": "F8" } },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("cancels recording with Escape without letting it reach the surface", async () => {
    const onSave = vi.fn();
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);

    await render({ keymap: defaultKeymapSettings("mac") }, "mac", onSave);

    await click(editButton("editor.save"));
    await press("editor.save", { key: "k", metaKey: true });
    await press("editor.save", { key: "Escape" });

    expect(host.querySelector(".settings-kb__recorder")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("ignores a bare modifier tap while recording", async () => {
    const onSave = vi.fn();

    await render({ keymap: defaultKeymapSettings("mac") }, "mac", onSave);

    await click(editButton("editor.save"));
    await press("editor.save", { key: "Meta", metaKey: true });

    expect(recordingInput("editor.save").value).toBe("");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not hijack Shift+Tab or a typed plus while recording", async () => {
    const onSave = vi.fn();

    await render({ keymap: defaultKeymapSettings("mac") }, "mac", onSave);

    await click(editButton("editor.save"));

    const shiftTab = keyboardEvent({ key: "Tab", shiftKey: true });
    await act(async () => {
      recordingInput("editor.save").dispatchEvent(shiftTab);
      await Promise.resolve();
    });
    expect(shiftTab.defaultPrevented).toBe(false);

    const plus = keyboardEvent({ key: "+", shiftKey: true });
    await act(async () => {
      recordingInput("editor.save").dispatchEvent(plus);
      await Promise.resolve();
    });
    expect(plus.defaultPrevented).toBe(false);

    expect(recordingInput("editor.save").value).toBe("");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("warns about colliding shortcuts and clears the warning once they differ", async () => {
    const onSave = vi.fn();
    const keymap = defaultKeymapSettings("mac");

    await render({ keymap }, "mac", onSave);
    expect(conflictWarning("editor.save")).toBeNull();

    await click(editButton("editor.save"));
    await press("editor.save", { key: "w", metaKey: true });
    await click(saveButton("editor.save"));

    expect(conflictWarning("editor.save")?.getAttribute("title")).toContain("Close Tab or Window");
    expect(conflictWarning("editor.closeTab")?.getAttribute("title")).toContain("Save File");

    await click(editButton("editor.save"));
    await press("editor.save", { key: "z", altKey: true, metaKey: true, shiftKey: true });
    await click(saveButton("editor.save"));

    expect(conflictWarning("editor.save")).toBeNull();
    expect(conflictWarning("editor.closeTab")).toBeNull();
  });

  it("presents conflicts for identical two-stroke chords", async () => {
    await render(
      {
        keymap: {
          ...defaultKeymapSettings("mac"),
          "editor.closeTab": "Cmd+K Cmd+S",
          "editor.save": "Cmd+K Cmd+S",
        },
      },
      "mac",
    );

    expect(conflictWarning("editor.save")?.getAttribute("title")).toContain("Close Tab or Window");
  });

  it("presents exact conflicts before first-stroke prefix conflicts", async () => {
    await render(
      {
        keymap: {
          ...defaultKeymapSettings("mac"),
          "editor.closeTab": "Cmd+K Cmd+S",
          "editor.formatDocument": "Cmd+K Cmd+S",
          "editor.save": "Cmd+K",
        },
      },
      "mac",
    );

    const title = conflictWarning("editor.closeTab")?.getAttribute("title") ?? "";

    expect(title).toContain("Also used by Format Document");
    expect(title).toContain("Shares a first key with Save File");
    expect(title.indexOf("Also used by")).toBeLessThan(title.indexOf("Shares a first key with"));
  });

  it("treats Cmd and Ctrl chords as the same conflict on Linux", async () => {
    await render(
      {
        keymap: {
          ...defaultKeymapSettings("mac"),
          "editor.closeTab": "Ctrl+K Ctrl+S",
          "editor.save": "Cmd+K Cmd+S",
        },
      },
      "linux",
    );

    expect(conflictWarning("editor.save")?.getAttribute("title")).toContain(
      "Also used by Close Tab or Window",
    );
    expect(conflictWarning("editor.closeTab")?.getAttribute("title")).toContain(
      "Also used by Save File",
    );
  });

  it("warns about reserved shortcuts while keeping them read-only", async () => {
    await render({ keymap: { ...defaultKeymapSettings("mac"), "editor.save": "Ctrl+Tab" } }, "mac");

    expect(editButton("editor.nextRecentlyUsedEditor").disabled).toBe(true);
    expect(conflictWarning("editor.save")?.getAttribute("title")).toContain(
      "Also used by Open Next Recently Used Editor",
    );
  });

  it("marks a rebound command as modified", async () => {
    await render(
      { keymap: { ...defaultKeymapSettings("mac"), "editor.save": "Cmd+Alt+S" } },
      "mac",
    );

    expect(statusCell("editor.save")?.textContent).toContain("Modified");
    expect(statusCell("editor.closeTab")?.textContent).not.toContain("Modified");
  });

  async function render(
    settings: Partial<AppSettings>,
    platform: KeymapPlatform,
    onSave: (input: SettingsSaveInput) => void = () => undefined,
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          appSettings={{ ...defaultAppSettings(), ...settings }}
          onSave={onSave}
          platform={platform}
        />,
      );
      await Promise.resolve();
    });
  }

  function rowFor(commandId: string): HTMLElement {
    const row = host.querySelector<HTMLElement>(`[data-command="${commandId}"]`);

    expect(row).not.toBeNull();

    return row as HTMLElement;
  }

  function keyCell(commandId: string): HTMLElement | null {
    return rowFor(commandId).querySelector<HTMLElement>(".settings-kb__key");
  }

  function statusCell(commandId: string): HTMLElement | null {
    return rowFor(commandId).querySelector<HTMLElement>(".settings-kb__st");
  }

  function whenCell(commandId: string): string {
    return rowFor(commandId).querySelector(".settings-kb__when")?.textContent ?? "";
  }

  function chipsFor(commandId: string): string[] {
    return [...rowFor(commandId).querySelectorAll(".settings-kbd")].map(
      (chip) => chip.textContent ?? "",
    );
  }

  function conflictWarning(commandId: string): HTMLElement | null {
    return rowFor(commandId).querySelector<HTMLElement>(".settings-kb__warn");
  }

  function editButton(commandId: string): HTMLButtonElement {
    const button = rowFor(commandId).querySelector<HTMLButtonElement>(".settings-kb__edit");

    expect(button).not.toBeNull();

    return button as HTMLButtonElement;
  }

  function menuButton(commandId: string): HTMLButtonElement {
    return buttonWithLabel(rowFor(commandId), /^More actions for /u);
  }

  function saveButton(commandId: string): HTMLButtonElement {
    const button = rowFor(commandId).querySelector<HTMLButtonElement>(
      ".settings-kb__recorder button",
    );

    expect(button).not.toBeNull();

    return button as HTMLButtonElement;
  }

  function recordingInput(commandId: string): HTMLInputElement {
    const input = rowFor(commandId).querySelector<HTMLInputElement>(".settings-input--rec");

    expect(input).not.toBeNull();

    return input as HTMLInputElement;
  }

  function actionButton(label: string): HTMLButtonElement {
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );

    expect(button).toBeTruthy();

    return button as HTMLButtonElement;
  }

  function buttonWithLabel(scope: HTMLElement, pattern: RegExp): HTMLButtonElement {
    const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
      pattern.test(candidate.getAttribute("aria-label") ?? ""),
    );

    expect(button).toBeTruthy();

    return button as HTMLButtonElement;
  }

  function filterInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search keybindings"]');

    expect(input).not.toBeNull();

    return input as HTMLInputElement;
  }

  async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      setNativeInputValue(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function press(commandId: string, init: KeyboardEventInit): Promise<void> {
    await act(async () => {
      recordingInput(commandId).dispatchEvent(keyboardEvent(init));
      await Promise.resolve();
    });
  }
});

describe("keybindingsPresentation", () => {
  it("renders modifier glyphs per platform", () => {
    expect(keybindingStrokes("Cmd+Shift+P", "mac")).toEqual([{ chips: ["⌘", "⇧", "P"] }]);
    expect(keybindingStrokes("Cmd+Shift+P", "windows")).toEqual([
      { chips: ["Ctrl", "Shift", "P"] },
    ]);
  });

  it("splits a chord into two strokes", () => {
    expect(keybindingStrokes("Cmd+K Cmd+S", "mac")).toEqual([
      { chips: ["⌘", "K"] },
      { chips: ["⌘", "S"] },
    ]);
  });

  it("renders an unbound shortcut as no strokes", () => {
    expect(keybindingStrokes("", "mac")).toEqual([]);
  });

  it("pluralizes the binding count", () => {
    expect(keybindingCountLabel([])).toBe("0 bindings");
    expect(
      keybindingCountLabel([
        {
          category: "Editor",
          bindings: [
            {
              category: "Editor",
              commandId: "editor.save",
              conflictTitle: null,
              conflicts: [],
              currentShortcut: "Cmd+S",
              defaultShortcut: "Cmd+S",
              label: "Save File",
              modified: false,
              rebindable: true,
              strokes: [],
            },
          ],
        },
      ]),
    ).toBe("1 binding");
  });
});

function keyboardEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  setter?.call(input, value);
}
