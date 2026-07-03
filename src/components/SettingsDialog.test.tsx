// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { defaultKeymapSettings } from "../domain/keymap";
import type { SystemFontGateway } from "../domain/systemFonts";
import { SettingsDialog, snippetLanguageOptions } from "./SettingsDialog";

describe("snippetLanguageOptions", () => {
  it("offers Latte and NEON alongside the existing snippet languages", () => {
    const ids = snippetLanguageOptions.map((option) => option.id);
    expect(ids).toContain("php");
    expect(ids).toContain("blade");
    expect(ids).toContain("latte");
    expect(ids).toContain("neon");
    const latte = snippetLanguageOptions.find((option) => option.id === "latte");
    const neon = snippetLanguageOptions.find((option) => option.id === "neon");
    expect(latte?.label).toBe("Latte");
    expect(neon?.label).toBe("NEON");
  });
});

describe("SettingsDialog", () => {
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
    vi.unstubAllGlobals();
  });

  it("autosaves setting changes without a Save button", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Save",
      ),
    ).toBe(false);

    await act(async () => {
      revealActiveFileCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        revealActiveFileInTree: false,
      },
    });
  });

  it("keeps Auto Save enabled by default and persists disabling it from settings", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(autoSaveCheckbox().checked).toBe(true);

    await act(async () => {
      autoSaveCheckbox().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        autoSaveConfigured: true,
      },
    });
  });

  it("keeps Format on Save disabled by default and persists enabling it from settings", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(formatOnSaveCheckbox().checked).toBe(false);

    await act(async () => {
      formatOnSaveCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        formatOnSave: true,
      },
    });
  });

  it("keeps Optimize imports on save disabled by default and persists enabling it from settings", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(optimizeImportsOnSaveCheckbox().checked).toBe(false);

    await act(async () => {
      optimizeImportsOnSaveCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        optimizeImportsOnSave: true,
      },
    });
  });

  it("keeps Format on Paste disabled by default and persists enabling it from settings", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(formatOnPasteCheckbox().checked).toBe(false);

    await act(async () => {
      formatOnPasteCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        formatOnPaste: true,
      },
    });
  });

  it("persists default indentation settings", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(defaultTabSizeSelect().value).toBe("4");
    expect(defaultInsertSpacesCheckbox().checked).toBe(true);

    await act(async () => {
      defaultTabSizeSelect().value = "2";
      defaultTabSizeSelect().dispatchEvent(
        new Event("change", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        defaultTabSize: 2,
      },
    });

    await act(async () => {
      defaultInsertSpacesCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        defaultInsertSpaces: false,
        defaultTabSize: 2,
      },
    });
  });

  it("offers cursor position and git branch status bar toggles in settings", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(checkboxWithLabel("Cursor position").checked).toBe(true);
    expect(checkboxWithLabel("Git branch").checked).toBe(true);

    await act(async () => {
      checkboxWithLabel("Cursor position").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        statusBar: {
          ...defaultWorkspaceSettings().statusBar,
          cursorPosition: false,
        },
      },
    });
  });

  it("renders the Directory Mappings section with auto-detected and manual repositories", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          gitDetectedRepositoryMappings={["workbench/lcsk/attendance"]}
          initialSection="git"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={{
            ...defaultWorkspaceSettings(),
            gitDirectoryMappings: ["packages/lib"],
          }}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Directory Mappings");
    // Auto-detected repository is listed and marked as auto-detected.
    expect(host.textContent).toContain("workbench/lcsk/attendance");
    expect(host.textContent).toContain("Auto-detected");
    // Manual mapping is listed and removable.
    expect(host.textContent).toContain("packages/lib");
    expect(
      checkboxWithLabel("Detect repositories automatically").checked,
    ).toBe(true);
  });

  it("persists disabling automatic repository detection", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="git"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      checkboxWithLabel("Detect repositories automatically").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappingsAuto: false,
      },
    });
  });

  it("adds and removes a manual repository directory mapping", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="git"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    const addInput = inputWithLabel("Add repository directory");

    await act(async () => {
      changeInputValue(addInput, "workbench/lcsk/x");
      await Promise.resolve();
    });

    await act(async () => {
      settingsSectionButton("Add").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: ["workbench/lcsk/x"],
      },
    });

    // Now remove it.
    const removeButton = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.getAttribute("title") === "Remove mapping");
    expect(removeButton).toBeTruthy();

    await act(async () => {
      removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: [],
      },
    });
  });

  it("persists JavaScript and TypeScript service mode changes", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      javaScriptTypeScriptServiceSelect().value = "off";
      javaScriptTypeScriptServiceSelect().dispatchEvent(
        new Event("change", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptService: "off",
      },
    });
  });

  it("shows platform-specific keymap placeholders", async () => {
    stubNavigatorPlatform("Linux x86_64");

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={{
            ...defaultAppSettings(),
            keymap: {
              ...defaultKeymapSettings("linux"),
              "editor.save": "",
            },
          }}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      settingsSectionButton("Keymap").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(inputWithLabel("Save File").placeholder).toBe("Ctrl+S");
  });

  it("filters keymap commands by the search box", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    const totalBefore = host.querySelectorAll(".keymap-field").length;
    expect(totalBefore).toBeGreaterThan(1);

    const search = keymapSearchInput();

    await act(async () => {
      changeInputValue(search, "Save File");
      await Promise.resolve();
    });

    const fields = Array.from(host.querySelectorAll(".keymap-field"));
    expect(fields).toHaveLength(1);
    expect(fields[0]?.textContent).toContain("Save File");
  });

  it("matches keymap commands by category and id, case-insensitively", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    const search = keymapSearchInput();

    await act(async () => {
      changeInputValue(search, "editor.save");
      await Promise.resolve();
    });

    const byId = Array.from(host.querySelectorAll(".keymap-field"));
    expect(byId.some((field) => field.textContent?.includes("Save File"))).toBe(
      true,
    );

    await act(async () => {
      changeInputValue(search, "git");
      await Promise.resolve();
    });

    const byCategory = Array.from(host.querySelectorAll(".keymap-field"));
    expect(byCategory.length).toBeGreaterThan(0);
    expect(
      byCategory.every((field) =>
        field.textContent?.toLowerCase().includes("git"),
      ),
    ).toBe(true);
  });

  it("matches keymap commands by their current and default shortcuts", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={{
            ...defaultAppSettings(),
            keymap: {
              ...defaultKeymapSettings(),
              "editor.formatDocument": "",
              "editor.save": "Cmd+Alt+Shift+S",
            },
          }}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    const search = keymapSearchInput();

    await act(async () => {
      changeInputValue(search, "alt+shift+s");
      await Promise.resolve();
    });

    let fields = Array.from(host.querySelectorAll(".keymap-field"));
    expect(fields).toHaveLength(1);
    expect(fields[0]?.textContent).toContain("Save File");

    await act(async () => {
      changeInputValue(search, "shift+alt+f");
      await Promise.resolve();
    });

    fields = Array.from(host.querySelectorAll(".keymap-field"));
    expect(fields.length).toBeGreaterThan(0);
    expect(
      fields.some((field) => field.textContent?.includes("Format Document")),
    ).toBe(true);
  });

  it("normalizes and persists keymap shortcut rebindings through app settings", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      changeInputValue(inputWithLabel("Save File"), "cmd + alt + s");
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        keymap: {
          ...defaultKeymapSettings(),
          "editor.save": "Cmd+Alt+S",
        },
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("persists conflicting keymap shortcuts without rewriting other bindings", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      changeInputValue(inputWithLabel("Save File"), "Cmd+W");
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        keymap: {
          ...defaultKeymapSettings(),
          "editor.save": "Cmd+W",
        },
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("warns when a rebound shortcut collides with another command", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(keymapConflictWarning("Save File")).toBeNull();

    await act(async () => {
      changeInputValue(inputWithLabel("Save File"), "Cmd+W");
      await Promise.resolve();
    });

    expect(keymapConflictWarning("Save File")?.textContent).toContain(
      "Close Tab or Window",
    );
    expect(keymapConflictWarning("Close Tab or Window")?.textContent).toContain(
      "Save File",
    );
  });

  it("does not warn once a rebound shortcut no longer collides", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={{
            ...defaultAppSettings(),
            keymap: {
              ...defaultKeymapSettings(),
              "editor.save": "Cmd+W",
            },
          }}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(keymapConflictWarning("Save File")).not.toBeNull();

    await act(async () => {
      changeInputValue(inputWithLabel("Save File"), "Cmd+Alt+Shift+Z");
      await Promise.resolve();
    });

    expect(keymapConflictWarning("Save File")).toBeNull();
    expect(keymapConflictWarning("Close Tab or Window")).toBeNull();
  });

  it("captures a shortcut from a real key press instead of typed text", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    const field = inputWithLabel("Close Tab or Window");

    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "w",
          metaKey: true,
          shiftKey: true,
        }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        keymap: {
          ...defaultKeymapSettings(),
          "editor.closeTab": "Cmd+Shift+W",
        },
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("does not hijack Shift+Tab or Shift-typed characters in a keymap field", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    const field = inputWithLabel("Save File");

    // Shift+Tab must stay reverse focus navigation, not become a binding.
    const shiftTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
      shiftKey: true,
    });

    await act(async () => {
      field.dispatchEvent(shiftTab);
      await Promise.resolve();
    });

    expect(shiftTab.defaultPrevented).toBe(false);
    expect(onSave).not.toHaveBeenCalled();

    // Shift+= produces "+" - the delimiter users need to TYPE shortcuts like
    // "Cmd+Alt+T" by hand; it must fall through to normal text input.
    const plusKey = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "+",
      shiftKey: true,
    });

    await act(async () => {
      field.dispatchEvent(plusKey);
      await Promise.resolve();
    });

    expect(plusKey.defaultPrevented).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ignores a bare modifier tap and lets Escape close the dialog from a keymap field", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="keymap"
          isOpen={true}
          onClose={onClose}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    const field = inputWithLabel("Save File");

    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Meta",
          metaKey: true,
        }),
      );
      await Promise.resolve();
    });

    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }),
      );
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores every keymap command when the search box is cleared", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="keymap"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    const totalBefore = host.querySelectorAll(".keymap-field").length;
    const search = keymapSearchInput();

    await act(async () => {
      changeInputValue(search, "Save File");
      await Promise.resolve();
    });
    expect(host.querySelectorAll(".keymap-field")).toHaveLength(1);

    await act(async () => {
      changeInputValue(search, "");
      await Promise.resolve();
    });

    expect(host.querySelectorAll(".keymap-field")).toHaveLength(totalBefore);
  });

  it("opens directly to the requested settings section", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="appearance"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(settingsSectionButton("Appearance").ariaSelected).toBe("true");
    expect(selectWithLabel("Font family")).not.toBeNull();
  });

  it("loads monospace font families from the system font gateway", async () => {
    const systemFontGateway: SystemFontGateway = {
      listMonospaceFontFamilies: vi.fn(async () => [
        "Iosevka",
        "Fira Code",
        "Iosevka",
      ]),
    };

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          systemFontGateway={systemFontGateway}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      settingsSectionButton("Appearance").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(selectWithLabel("Theme")).not.toBeNull();
    expect(systemFontGateway.listMonospaceFontFamilies).toHaveBeenCalled();
    await waitForFontFamilyOptions([
      "Fira Code",
      "Iosevka",
      defaultAppSettings().editorFontFamily,
    ]);
    expect(inputWithLabel("Font size").type).toBe("number");
    expect(checkboxWithLabel("Font ligatures").checked).toBe(false);
  });

  it("ignores stale font family refresh results", async () => {
    let resolveInitialFonts: (fontFamilies: string[]) => void = () => undefined;
    const initialFonts = new Promise<string[]>((resolve) => {
      resolveInitialFonts = resolve;
    });
    const systemFontGateway: SystemFontGateway = {
      listMonospaceFontFamilies: vi
        .fn<() => Promise<string[]>>()
        .mockReturnValueOnce(initialFonts)
        .mockResolvedValueOnce(["Iosevka"]),
    };

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="appearance"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          systemFontGateway={systemFontGateway}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
    });

    await act(async () => {
      refreshFontsButton().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    await waitForFontFamilyOptions([
      "Iosevka",
      defaultAppSettings().editorFontFamily,
    ]);

    await act(async () => {
      resolveInitialFonts(["Fira Code"]);
    });

    await waitForFontFamilyOptions([
      "Iosevka",
      defaultAppSettings().editorFontFamily,
    ]);
  });

  it("persists editor font appearance changes", async () => {
    const onSave = vi.fn(async () => undefined);
    const systemFontGateway: SystemFontGateway = {
      listMonospaceFontFamilies: vi.fn(async () => ["Fira Code"]),
    };

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          systemFontGateway={systemFontGateway}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
    });

    await act(async () => {
      settingsSectionButton("Appearance").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    await waitForFontFamilyOptions([
      "Fira Code",
      defaultAppSettings().editorFontFamily,
    ]);

    await act(async () => {
      selectWithLabel("Font family").value = "Fira Code";
      selectWithLabel("Font family").dispatchEvent(
        new Event("change", { bubbles: true }),
      );
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        editorFontFamily: "Fira Code, monospace",
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });

    await act(async () => {
      changeInputValue(inputWithLabel("Font size"), "16", "change");
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        editorFontFamily: "Fira Code, monospace",
        editorFontSize: 16,
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });

    await act(async () => {
      checkboxWithLabel("Font ligatures").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        editorFontFamily: "Fira Code, monospace",
        editorFontLigatures: true,
        editorFontSize: 16,
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("persists theme changes while preserving workspace settings and trust", async () => {
    const onSave = vi.fn(async () => undefined);
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      defaultTabSize: 2,
      revealActiveFileInTree: false,
      statusBar: {
        ...defaultWorkspaceSettings().statusBar,
        message: false,
      },
    };

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="appearance"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={workspaceSettings}
          workspaceTrust={{ rootPath: "/workspace", trusted: false }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectWithLabel("Theme").value = "oneDarkPro";
      selectWithLabel("Theme").dispatchEvent(
        new Event("change", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        theme: "oneDarkPro",
      },
      trusted: false,
      workspaceSettings,
    });
  });

  it("persists TypeScript version preference changes", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      typeScriptVersionSelect().value = "workspace";
      typeScriptVersionSelect().dispatchEvent(
        new Event("change", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptVersion: "workspace",
      },
    });
  });

  it("persists JavaScript and TypeScript validation, auto imports, automatic type acquisition, and inlay hint changes", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      javaScriptTypeScriptValidationCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptValidation: false,
      },
    });

    await act(async () => {
      javaScriptTypeScriptAutoImportsCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptValidation: false,
      },
    });

    expect(
      javaScriptTypeScriptAutomaticTypeAcquisitionCheckbox().checked,
    ).toBe(false);

    await act(async () => {
      javaScriptTypeScriptAutomaticTypeAcquisitionCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptAutomaticTypeAcquisition: true,
        javaScriptTypeScriptValidation: false,
      },
    });

    await act(async () => {
      javaScriptTypeScriptInlayHintsCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptAutomaticTypeAcquisition: true,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptValidation: false,
      },
    });

    await act(async () => {
      javaScriptTypeScriptCodeLensCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptAutomaticTypeAcquisition: true,
        javaScriptTypeScriptCodeLens: true,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptValidation: false,
      },
    });

    await act(async () => {
      javaScriptTypeScriptReferencesCodeLensOnAllFunctionsCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptAutomaticTypeAcquisition: true,
        javaScriptTypeScriptCodeLens: true,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptReferencesCodeLensOnAllFunctions: true,
        javaScriptTypeScriptValidation: false,
      },
    });
  });

  it("persists JavaScript and TypeScript import preferences", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      javaScriptTypeScriptImportModuleSpecifierSelect().value =
        "project-relative";
      javaScriptTypeScriptImportModuleSpecifierSelect().dispatchEvent(
        new Event("change", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptImportModuleSpecifierPreference:
          "project-relative",
      },
    });

    await act(async () => {
      javaScriptTypeScriptImportModuleSpecifierEndingSelect().value = "minimal";
      javaScriptTypeScriptImportModuleSpecifierEndingSelect().dispatchEvent(
        new Event("change", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptImportModuleSpecifierEnding: "minimal",
        javaScriptTypeScriptImportModuleSpecifierPreference:
          "project-relative",
      },
    });

    await act(async () => {
      javaScriptTypeScriptQuotePreferenceSelect().value = "single";
      javaScriptTypeScriptQuotePreferenceSelect().dispatchEvent(
        new Event("change", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptImportModuleSpecifierEnding: "minimal",
        javaScriptTypeScriptImportModuleSpecifierPreference:
          "project-relative",
        javaScriptTypeScriptQuotePreference: "single",
      },
    });

    await act(async () => {
      javaScriptTypeScriptPreferTypeOnlyAutoImportsCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptImportModuleSpecifierEnding: "minimal",
        javaScriptTypeScriptImportModuleSpecifierPreference:
          "project-relative",
        javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
        javaScriptTypeScriptQuotePreference: "single",
      },
    });
  });

  it("persists JavaScript and TypeScript on-save source action changes", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(javaScriptTypeScriptOrganizeImportsOnSaveCheckbox().checked).toBe(
      false,
    );
    expect(javaScriptTypeScriptRemoveUnusedOnSaveCheckbox().checked).toBe(false);
    expect(javaScriptTypeScriptAddMissingImportsOnSaveCheckbox().checked).toBe(
      false,
    );
    expect(javaScriptTypeScriptFixAllOnSaveCheckbox().checked).toBe(false);

    await act(async () => {
      javaScriptTypeScriptOrganizeImportsOnSaveCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptOrganizeImportsOnSave: true,
      },
    });

    await act(async () => {
      javaScriptTypeScriptRemoveUnusedOnSaveCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptOrganizeImportsOnSave: true,
        javaScriptTypeScriptRemoveUnusedOnSave: true,
      },
    });

    await act(async () => {
      javaScriptTypeScriptAddMissingImportsOnSaveCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAddMissingImportsOnSave: true,
        javaScriptTypeScriptOrganizeImportsOnSave: true,
        javaScriptTypeScriptRemoveUnusedOnSave: true,
      },
    });

    await act(async () => {
      javaScriptTypeScriptFixAllOnSaveCheckbox().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAddMissingImportsOnSave: true,
        javaScriptTypeScriptFixAllOnSave: true,
        javaScriptTypeScriptOrganizeImportsOnSave: true,
        javaScriptTypeScriptRemoveUnusedOnSave: true,
      },
    });
  });

  it("persists the PHP inlay hints toggle", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          initialSection="php"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(checkboxWithLabel("PHP inlay hints").checked).toBe(true);

    await act(async () => {
      checkboxWithLabel("PHP inlay hints").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        phpInlayHints: false,
      },
    });
  });

  it("restarts JavaScript and TypeScript service from settings", async () => {
    const onRestart = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={onRestart}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      restartJavaScriptTypeScriptServiceButton().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("opens JavaScript and TypeScript service log from settings", async () => {
    const onOpenLog = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={onOpenLog}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      openJavaScriptTypeScriptServiceLogButton().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onOpenLog).toHaveBeenCalledTimes(1);
  });

  it("disables JavaScript and TypeScript restart when the service is off", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={{
            ...defaultWorkspaceSettings(),
            javaScriptTypeScriptService: "off",
          }}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    expect(restartJavaScriptTypeScriptServiceButton().disabled).toBe(true);
  });

  it("disables workspace JavaScript and TypeScript controls without an open workspace", async () => {
    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={vi.fn(async () => undefined)}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot={null}
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={null}
        />,
      );
      await Promise.resolve();
    });

    expect(javaScriptTypeScriptAutomaticTypeAcquisitionCheckbox().disabled).toBe(
      true,
    );
  });

  it("adds a user snippet from the Snippets section", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={defaultAppSettings()}
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      settingsSectionButton("Snippets").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      addSnippetButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const lastCall = (onSave.mock.calls as unknown[][])[onSave.mock.calls.length - 1]?.[0] as
      | { appSettings: { userSnippets: unknown[] } }
      | undefined;

    expect(lastCall?.appSettings.userSnippets).toHaveLength(1);
  });

  it("edits and persists an existing user snippet", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={{
            ...defaultAppSettings(),
            userSnippets: [
              {
                prefix: "myhelper",
                body: "helper($0);",
                description: "Call helper",
                languages: ["php"],
              },
            ],
          }}
          initialSection="snippets"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    const prefixInput = snippetPrefixInputs()[0];
    expect(prefixInput.value).toBe("myhelper");

    await act(async () => {
      changeInputValue(prefixInput, "newprefix");
      await Promise.resolve();
    });

    const lastCall = (onSave.mock.calls as unknown[][])[onSave.mock.calls.length - 1]?.[0] as
      | {
          appSettings: { userSnippets: Array<{ prefix: string }> };
        }
      | undefined;

    expect(lastCall?.appSettings.userSnippets[0].prefix).toBe("newprefix");
  });

  it("deletes a user snippet", async () => {
    const onSave = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <SettingsDialog
          appSettings={{
            ...defaultAppSettings(),
            userSnippets: [
              {
                prefix: "myhelper",
                body: "helper($0);",
                description: "Call helper",
                languages: ["php"],
              },
            ],
          }}
          initialSection="snippets"
          isOpen={true}
          onClose={vi.fn()}
          onOpenJavaScriptTypeScriptServiceLog={vi.fn()}
          onRestartJavaScriptTypeScriptService={vi.fn()}
          onSave={onSave}
          phpTools={null}
          workspaceDescriptor={null}
          workspaceRoot="/workspace"
          workspaceSettings={defaultWorkspaceSettings()}
          workspaceTrust={{ rootPath: "/workspace", trusted: true }}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      deleteSnippetButtons()[0].dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const lastCall = (onSave.mock.calls as unknown[][])[onSave.mock.calls.length - 1]?.[0] as
      | { appSettings: { userSnippets: unknown[] } }
      | undefined;

    expect(lastCall?.appSettings.userSnippets).toEqual([]);
  });

  function addSnippetButton(): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Add snippet"),
    );

    if (!button) {
      throw new Error("Add snippet button was not rendered.");
    }

    return button;
  }

  function snippetPrefixInputs(): HTMLInputElement[] {
    return Array.from(
      host.querySelectorAll<HTMLInputElement>(
        "input[data-snippet-field='prefix']",
      ),
    );
  }

  function deleteSnippetButtons(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll("button")).filter((item) =>
      item.textContent?.includes("Delete snippet"),
    );
  }

  function revealActiveFileCheckbox(): HTMLInputElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) =>
      item.textContent?.includes("Reveal active file in tree"),
    );
    const input = label?.querySelector<HTMLInputElement>("input");

    if (!input) {
      throw new Error("Reveal active file checkbox was not rendered.");
    }

    return input;
  }

  function autoSaveCheckbox(): HTMLInputElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) => item.textContent?.includes("Auto Save"));
    const input = label?.querySelector<HTMLInputElement>("input");

    if (!input) {
      throw new Error("Auto Save checkbox was not rendered.");
    }

    return input;
  }

  function formatOnSaveCheckbox(): HTMLInputElement {
    return checkboxWithLabel("Format on Save");
  }

  function formatOnPasteCheckbox(): HTMLInputElement {
    return checkboxWithLabel("Format on Paste");
  }

  function defaultTabSizeSelect(): HTMLSelectElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) =>
      item.textContent?.includes("Default tab size"),
    );
    const select = label?.querySelector<HTMLSelectElement>("select");

    if (!select) {
      throw new Error("Default tab size select was not rendered.");
    }

    return select;
  }

  function defaultInsertSpacesCheckbox(): HTMLInputElement {
    return checkboxWithLabel("Insert spaces by default");
  }

  function optimizeImportsOnSaveCheckbox(): HTMLInputElement {
    return checkboxWithLabel("Optimize imports on save");
  }

  function javaScriptTypeScriptServiceSelect(): HTMLSelectElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) =>
      item.textContent?.includes("JavaScript/TypeScript service"),
    );
    const select = label?.querySelector<HTMLSelectElement>("select");

    if (!select) {
      throw new Error("JavaScript/TypeScript service select was not rendered.");
    }

    return select;
  }

  function typeScriptVersionSelect(): HTMLSelectElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) =>
      item.textContent?.includes("TypeScript version"),
    );
    const select = label?.querySelector<HTMLSelectElement>("select");

    if (!select) {
      throw new Error("TypeScript version select was not rendered.");
    }

    return select;
  }

  function javaScriptTypeScriptValidationCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JavaScript/TypeScript validation");
  }

  function javaScriptTypeScriptAutoImportsCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JavaScript/TypeScript auto imports");
  }

  function javaScriptTypeScriptImportModuleSpecifierSelect(): HTMLSelectElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) =>
      item.textContent?.includes("JS/TS import module specifier"),
    );
    const select = label?.querySelector<HTMLSelectElement>("select");

    if (!select) {
      throw new Error("JS/TS import module specifier select was not rendered.");
    }

    return select;
  }

  function javaScriptTypeScriptImportModuleSpecifierEndingSelect(): HTMLSelectElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) =>
      item.textContent?.includes("JS/TS import module specifier ending"),
    );
    const select = label?.querySelector<HTMLSelectElement>("select");

    if (!select) {
      throw new Error(
        "JS/TS import module specifier ending select was not rendered.",
      );
    }

    return select;
  }

  function javaScriptTypeScriptQuotePreferenceSelect(): HTMLSelectElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) =>
      item.textContent?.includes("JS/TS import quotes"),
    );
    const select = label?.querySelector<HTMLSelectElement>("select");

    if (!select) {
      throw new Error("JS/TS import quotes select was not rendered.");
    }

    return select;
  }

  function javaScriptTypeScriptPreferTypeOnlyAutoImportsCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JS/TS prefer type-only auto imports");
  }

  function javaScriptTypeScriptAutomaticTypeAcquisitionCheckbox(): HTMLInputElement {
    return checkboxWithLabel(
      "JavaScript/TypeScript automatic type acquisition",
    );
  }

  function javaScriptTypeScriptInlayHintsCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JavaScript/TypeScript inlay hints");
  }

  function javaScriptTypeScriptCodeLensCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JavaScript/TypeScript CodeLens");
  }

  function javaScriptTypeScriptReferencesCodeLensOnAllFunctionsCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JS/TS reference CodeLens on all functions");
  }

  function javaScriptTypeScriptOrganizeImportsOnSaveCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JS/TS organize imports on save");
  }

  function javaScriptTypeScriptRemoveUnusedOnSaveCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JS/TS remove unused on save");
  }

  function javaScriptTypeScriptAddMissingImportsOnSaveCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JS/TS add missing imports on save");
  }

  function javaScriptTypeScriptFixAllOnSaveCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JS/TS fix all on save");
  }

  function restartJavaScriptTypeScriptServiceButton(): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Restart JavaScript/TypeScript service"),
    );

    if (!button) {
      throw new Error(
        "Restart JavaScript/TypeScript service button was not rendered.",
      );
    }

    return button;
  }

  function openJavaScriptTypeScriptServiceLogButton(): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Open JavaScript/TypeScript service log"),
    );

    if (!button) {
      throw new Error(
        "Open JavaScript/TypeScript service log button was not rendered.",
      );
    }

    return button;
  }

  function settingsSectionButton(labelText: string): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === labelText,
    );

    if (!button) {
      throw new Error(`${labelText} settings section was not rendered.`);
    }

    return button;
  }

  function inputWithLabel(labelText: string): HTMLInputElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) => item.textContent?.includes(labelText));
    const input = label?.querySelector<HTMLInputElement>("input");

    if (!input) {
      throw new Error(`${labelText} input was not rendered.`);
    }

    return input;
  }

  function keymapSearchInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(".keymap-search input");

    if (!input) {
      throw new Error("Keymap search input was not rendered.");
    }

    return input;
  }

  function keymapConflictWarning(commandLabel: string): Element | null {
    const fields = Array.from(host.querySelectorAll(".keymap-field"));
    const field = fields.find((item) =>
      item.querySelector("strong")?.textContent === commandLabel,
    );

    return field?.querySelector(".keymap-conflict") ?? null;
  }

  function changeInputValue(
    input: HTMLInputElement,
    value: string,
    eventName = "input",
  ): void {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;

    valueSetter?.call(input, value);
    input.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  function selectWithLabel(labelText: string): HTMLSelectElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) => item.textContent?.includes(labelText));
    const select = label?.querySelector<HTMLSelectElement>("select");

    if (!select) {
      throw new Error(`${labelText} select was not rendered.`);
    }

    return select;
  }

  function refreshFontsButton(): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("Refresh fonts"),
    );

    if (!button) {
      throw new Error("Refresh fonts button was not rendered.");
    }

    return button;
  }

  async function waitForFontFamilyOptions(
    expectedOptions: string[],
  ): Promise<void> {
    await vi.waitFor(() => {
      expect(
        Array.from(selectWithLabel("Font family").options).map(
          (option) => option.value,
        ),
      ).toEqual(expectedOptions);
    });
  }

  function checkboxWithLabel(labelText: string): HTMLInputElement {
    const labels = Array.from(host.querySelectorAll("label"));
    const label = labels.find((item) => item.textContent?.includes(labelText));
    const input = label?.querySelector<HTMLInputElement>("input");

    if (!input) {
      throw new Error(`${labelText} checkbox was not rendered.`);
    }

    return input;
  }

  function stubNavigatorPlatform(platform: string): void {
    vi.stubGlobal("navigator", {
      platform,
      userAgent: `Mozilla/5.0 (${platform})`,
      userAgentData: { platform },
    });
  }
});
