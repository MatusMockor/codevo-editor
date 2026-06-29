// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { defaultKeymapSettings } from "../domain/keymap";
import type { SystemFontGateway } from "../domain/systemFonts";
import { SettingsDialog } from "./SettingsDialog";

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

  it("persists JavaScript and TypeScript validation, auto imports, and inlay hint changes", async () => {
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
        javaScriptTypeScriptCodeLens: true,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptValidation: false,
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

  function javaScriptTypeScriptInlayHintsCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JavaScript/TypeScript inlay hints");
  }

  function javaScriptTypeScriptCodeLensCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JavaScript/TypeScript CodeLens");
  }

  function javaScriptTypeScriptOrganizeImportsOnSaveCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JS/TS organize imports on save");
  }

  function javaScriptTypeScriptRemoveUnusedOnSaveCheckbox(): HTMLInputElement {
    return checkboxWithLabel("JS/TS remove unused on save");
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
