// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { defaultKeymapSettings } from "../domain/keymap";
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
