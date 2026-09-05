// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  settingsIgnorePatternsText,
  type WorkspaceSettings,
} from "../../../domain/settings";
import type {
  SettingsDraftActions,
  SettingsEnvironment,
  SettingsSaveInput,
} from "../settingsPageProps";
import { IndexLanguagesSettingsPage } from "./IndexLanguagesSettingsPage";

const baseEnv: SettingsEnvironment = {
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
  readonly env: SettingsEnvironment;
  readonly workspaceSettings: WorkspaceSettings;
  onSave(input: SettingsSaveInput): void;
}

function Harness({ env, onSave, workspaceSettings }: HarnessProps) {
  const [settings, setSettings] = useState(workspaceSettings);
  const [ignorePatternsText, setIgnorePatternsText] = useState(() =>
    settingsIgnorePatternsText(workspaceSettings.extraIgnorePatterns),
  );
  const settingsRef = useRef(settings);
  const appSettings = defaultAppSettings();
  const actions: SettingsDraftActions = {
    publishAppSettings: () => undefined,
    save: (input) =>
      onSave({
        appSettings,
        trusted: true,
        workspaceSettings: input.workspaceSettings ?? settingsRef.current,
      }),
    updateAppSettings: () => undefined,
    updateIgnorePatternsText: setIgnorePatternsText,
    updateTrusted: () => undefined,
    updateWorkspaceSettings: (next) => {
      settingsRef.current = next;
      setSettings(next);
      onSave({ appSettings, trusted: true, workspaceSettings: next });
    },
  };

  return (
    <IndexLanguagesSettingsPage
      actions={actions}
      draft={{ appSettings, ignorePatternsText, trusted: true, workspaceSettings: settings }}
      env={env}
    />
  );
}

describe("IndexLanguagesSettingsPage", () => {
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

  it("persists large file limits", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await typeNumber(inputIn("index.largeFileCharacterLimit"), "524288");

    expect(lastWorkspaceSettings(onSave).largeFileMode.characterLimit).toBe(524_288);

    await typeNumber(inputIn("index.largeFileLineLimit"), "8000");

    expect(lastWorkspaceSettings(onSave).largeFileMode).toEqual({
      characterLimit: 524_288,
      lineLimit: 8_000,
    });
  });

  it("clamps a large file limit below its floor", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await typeNumber(inputIn("index.largeFileLineLimit"), "1");

    expect(lastWorkspaceSettings(onSave).largeFileMode.lineLimit).toBe(500);
  });

  it("persists extra ignore patterns as a normalized list", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await type(textAreaIn("index.extraIgnorePatterns"), "build/**\ncoverage/**");

    expect(lastWorkspaceSettings(onSave).extraIgnorePatterns).toEqual(["build/**", "coverage/**"]);
  });

  it("shows the built-in ignores read-only", async () => {
    await render({});

    expect(rowFor("index.builtInIgnores").textContent).toContain("node_modules");
  });

  it("persists JavaScript and TypeScript service mode and version", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await choose(selectIn("index.javaScriptTypeScriptService"), "off");
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptService).toBe("off");

    await choose(selectIn("index.javaScriptTypeScriptVersion"), "workspace");
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptVersion).toBe("workspace");
  });

  it("persists JavaScript and TypeScript import preferences", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await choose(selectIn("index.javaScriptTypeScriptImportModuleSpecifier"), "relative");
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptImportModuleSpecifierPreference).toBe(
      "relative",
    );

    await choose(selectIn("index.javaScriptTypeScriptImportModuleSpecifierEnding"), "js");
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptImportModuleSpecifierEnding).toBe(
      "js",
    );

    await choose(selectIn("index.javaScriptTypeScriptQuotePreference"), "single");
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptQuotePreference).toBe("single");
  });

  it("persists JavaScript and TypeScript analysis toggles", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await click(switchIn("index.javaScriptTypeScriptValidation"));
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptValidation).toBe(false);

    await click(switchIn("index.javaScriptTypeScriptAutomaticTypeAcquisition"));
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptAutomaticTypeAcquisition).toBe(true);

    await click(switchIn("index.javaScriptTypeScriptInlayHints"));
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptInlayHints).toBe(false);

    await click(switchIn("index.javaScriptTypeScriptCodeLens"));
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptCodeLens).toBe(true);
  });

  it("persists JavaScript and TypeScript on-save source actions", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await click(switchIn("index.javaScriptTypeScriptOrganizeImportsOnSave"));
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptOrganizeImportsOnSave).toBe(true);

    await click(switchIn("index.javaScriptTypeScriptRemoveUnusedOnSave"));
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptRemoveUnusedOnSave).toBe(true);

    await click(switchIn("index.javaScriptTypeScriptAddMissingImportsOnSave"));
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptAddMissingImportsOnSave).toBe(true);

    await click(switchIn("index.javaScriptTypeScriptFixAllOnSave"));
    expect(lastWorkspaceSettings(onSave).javaScriptTypeScriptFixAllOnSave).toBe(true);
  });

  it("restarts and opens the log for the JavaScript and TypeScript service", async () => {
    const onRestartJavaScriptTypeScriptService = vi.fn(async () => undefined);
    const onOpenJavaScriptTypeScriptServiceLog = vi.fn(async () => undefined);

    await render({}, undefined, {
      onOpenJavaScriptTypeScriptServiceLog,
      onRestartJavaScriptTypeScriptService,
    });

    await click(buttonIn("index.javaScriptTypeScriptServiceActions", "Restart"));
    expect(onRestartJavaScriptTypeScriptService).toHaveBeenCalledOnce();

    await click(buttonIn("index.javaScriptTypeScriptServiceActions", "Open log"));
    expect(onOpenJavaScriptTypeScriptServiceLog).toHaveBeenCalledOnce();
  });

  it("disables the restart action when the service is off", async () => {
    await render({ javaScriptTypeScriptService: "off" });

    expect(buttonIn("index.javaScriptTypeScriptServiceActions", "Restart").disabled).toBe(true);
    expect(buttonIn("index.javaScriptTypeScriptServiceActions", "Open log").disabled).toBe(false);
  });

  it("disables workspace controls without an open workspace", async () => {
    await render({}, undefined, { hasWorkspace: false, workspaceRoot: null });

    expect(switchIn("index.javaScriptTypeScriptAutomaticTypeAcquisition").disabled).toBe(true);
    expect(inputIn("index.eslintPath").disabled).toBe(true);
    expect(buttonIn("index.nodeLaunchConfigurations", "Edit").disabled).toBe(true);
  });

  it("opens the Node launch configurations editor", async () => {
    const onOpenNodeLaunchConfigurations = vi.fn();

    await render({}, undefined, { onOpenNodeLaunchConfigurations });

    await click(buttonIn("index.nodeLaunchConfigurations", "Edit"));

    expect(onOpenNodeLaunchConfigurations).toHaveBeenCalledOnce();
  });

  it("edits and normalizes the ESLint binary path", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await type(inputIn("index.eslintPath"), " /tools/eslint ");

    expect(lastWorkspaceSettings(onSave).eslintPath).toBe("/tools/eslint");
  });

  it("persists ESLint and Prettier on-save switches", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await click(switchIn("index.eslintAnalyseOnSave"));
    expect(lastWorkspaceSettings(onSave).eslintAnalyseOnSave).toBe(true);

    await click(switchIn("index.eslintFixOnSave"));
    expect(lastWorkspaceSettings(onSave).eslintFixOnSave).toBe(true);

    await click(switchIn("index.prettierFormatOnSave"));
    expect(lastWorkspaceSettings(onSave).prettierFormatOnSave).toBe(true);
  });

  it("lists auto-detected and manual repository mappings", async () => {
    await render({ gitDirectoryMappings: ["packages/lib"] }, undefined, {
      gitDetectedRepositoryMappings: ["workbench/lcsk/attendance"],
    });

    const row = rowFor("index.gitDirectoryMappings");

    expect(row.textContent).toContain("workbench/lcsk/attendance");
    expect(row.textContent).toContain("Auto-detected");
    expect(row.textContent).toContain("packages/lib");
    expect(switchIn("index.gitDirectoryMappingsAuto").getAttribute("aria-checked")).toBe("true");
  });

  it("persists disabling automatic repository detection", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await click(switchIn("index.gitDirectoryMappingsAuto"));

    expect(lastWorkspaceSettings(onSave).gitDirectoryMappingsAuto).toBe(false);
  });

  it("adds and removes a manual repository directory mapping", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await type(inputIn("index.gitDirectoryMappings"), "workbench/lcsk/x");
    await click(buttonIn("index.gitDirectoryMappings", "Add"));

    expect(lastWorkspaceSettings(onSave).gitDirectoryMappings).toEqual(["workbench/lcsk/x"]);

    const remove = [
      ...rowFor("index.gitDirectoryMappings").querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.getAttribute("title") === "Remove mapping");

    expect(remove).toBeTruthy();

    await click(remove as HTMLButtonElement);

    expect(lastWorkspaceSettings(onSave).gitDirectoryMappings).toEqual([]);
  });

  async function render(
    workspaceSettings: Partial<WorkspaceSettings> = {},
    onSave: (input: SettingsSaveInput) => void = () => undefined,
    envOverrides: Partial<SettingsEnvironment> = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          env={{ ...baseEnv, ...envOverrides }}
          onSave={onSave}
          workspaceSettings={{ ...defaultWorkspaceSettings(), ...workspaceSettings }}
        />,
      );
      await Promise.resolve();
    });
  }

  function rowFor(rowId: string): HTMLElement {
    const row = host.querySelector<HTMLElement>(`[data-settings-row="${rowId}"]`);

    expect(row).not.toBeNull();

    return row as HTMLElement;
  }

  function inputIn(rowId: string): HTMLInputElement {
    const input = rowFor(rowId).querySelector<HTMLInputElement>("input");

    expect(input).not.toBeNull();

    return input as HTMLInputElement;
  }

  function textAreaIn(rowId: string): HTMLTextAreaElement {
    const input = rowFor(rowId).querySelector<HTMLTextAreaElement>("textarea");

    expect(input).not.toBeNull();

    return input as HTMLTextAreaElement;
  }

  function selectIn(rowId: string): HTMLSelectElement {
    const select = rowFor(rowId).querySelector<HTMLSelectElement>("select");

    expect(select).not.toBeNull();

    return select as HTMLSelectElement;
  }

  function switchIn(rowId: string): HTMLButtonElement {
    const control = rowFor(rowId).querySelector<HTMLButtonElement>('[role="switch"]');

    expect(control).not.toBeNull();

    return control as HTMLButtonElement;
  }

  function buttonIn(rowId: string, text: string): HTMLButtonElement {
    const button = [...rowFor(rowId).querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === text,
    );

    expect(button).toBeTruthy();

    return button as HTMLButtonElement;
  }

  async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function type(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): Promise<void> {
    await act(async () => {
      setNativeValue(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function typeNumber(element: HTMLInputElement, value: string): Promise<void> {
    await type(element, value);
    await act(async () => {
      element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });
  }
});

function lastWorkspaceSettings(onSave: { mock: { calls: unknown[][] } }): WorkspaceSettings {
  const calls = onSave.mock.calls;
  const last = calls[calls.length - 1]?.[0] as SettingsSaveInput | undefined;

  expect(last).toBeTruthy();

  return (last as SettingsSaveInput).workspaceSettings;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  setter?.call(element, value);
}
