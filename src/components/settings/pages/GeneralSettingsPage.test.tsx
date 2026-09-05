// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type WorkspaceSettings,
} from "../../../domain/settings";
import type {
  SettingsDraftActions,
  SettingsEnvironment,
  SettingsSaveInput,
} from "../settingsPageProps";
import { GeneralSettingsPage } from "./GeneralSettingsPage";

describe("GeneralSettingsPage", () => {
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

  it("autosaves the terminal shell integration opt-in", () => {
    const onSave = render({});

    act(() => switchIn("general.terminalShellIntegration").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), terminalShellIntegrationEnabled: true },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("autosaves setting changes without a Save button", () => {
    const onSave = render({});

    expect(
      [...host.querySelectorAll("button")].some((candidate) => candidate.textContent === "Save"),
    ).toBe(false);

    act(() => switchIn("general.revealActiveFileInTree").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), revealActiveFileInTree: false },
    });
  });

  it("keeps Auto save enabled by default and persists disabling it", () => {
    const onSave = render({});

    expect(switchIn("general.autoSave").getAttribute("aria-checked")).toBe("true");

    act(() => switchIn("general.autoSave").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        autoSaveConfigured: true,
      },
    });
  });

  it("keeps Format on save disabled by default and persists enabling it", () => {
    const onSave = render({});

    expect(switchIn("general.formatOnSave").getAttribute("aria-checked")).toBe("false");

    act(() => switchIn("general.formatOnSave").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), formatOnSave: true },
    });
  });

  it("keeps Format on paste disabled by default and persists enabling it", () => {
    const onSave = render({});

    act(() => switchIn("general.formatOnPaste").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), formatOnPaste: true },
    });
  });

  it("keeps Optimize imports on save disabled by default and persists enabling it", () => {
    const onSave = render({});

    act(() => switchIn("general.optimizeImportsOnSave").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), optimizeImportsOnSave: true },
    });
  });

  it("persists default indentation settings", () => {
    const onSave = render({});
    const tabSize = () =>
      queryIn<HTMLInputElement>("general.defaultTabSize", 'input[type="number"]');

    expect(tabSize().valueAsNumber).toBe(4);
    expect(switchIn("general.defaultInsertSpaces").getAttribute("aria-checked")).toBe("true");

    act(() => changeInputValue(tabSize(), "2"));

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), defaultTabSize: 2 },
    });

    act(() => switchIn("general.defaultInsertSpaces").click());

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

  it("clamps the tab size stepper to the workspace bounds", () => {
    const onSave = render({
      workspaceSettings: { ...defaultWorkspaceSettings(), defaultTabSize: 8 },
    });
    const stepper = (label: string) =>
      queryIn<HTMLButtonElement>("general.defaultTabSize", `button[aria-label="${label}"]`);

    expect(stepper("Increase").disabled).toBe(true);

    act(() => stepper("Decrease").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), defaultTabSize: 7 },
    });
  });

  it("offers cursor position and git branch status bar chips", () => {
    const onSave = render({});

    expect(chip("Cursor position").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Git branch").getAttribute("aria-pressed")).toBe("true");

    act(() => chip("Cursor position").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        statusBar: { ...defaultWorkspaceSettings().statusBar, cursorPosition: false },
      },
    });
  });

  it("persists the intelligence mode from the segmented control", () => {
    const onSave = render({});
    const option = (label: string): HTMLButtonElement => {
      const match = [
        ...rowElement("general.intelligenceMode").querySelectorAll<HTMLButtonElement>(
          '[role="radio"]',
        ),
      ].find((candidate) => candidate.textContent === label);

      expect(match).toBeDefined();
      return match as HTMLButtonElement;
    };

    expect(option("Editor Mode").getAttribute("aria-checked")).toBe("true");

    act(() => option("IDE Mode").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), intelligenceMode: "fullSmart" },
    });
  });

  it("persists the background runtime policy", () => {
    const onSave = render({});
    const select = queryIn<HTMLSelectElement>("general.backgroundRuntimePolicy", "select");

    act(() => {
      select.value = "singleActive";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), runtimePolicy: "singleActive" },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("persists workspace trust separately from the settings drafts", () => {
    const onSave = render({ trusted: false });

    expect(switchIn("general.trustedWorkspace").getAttribute("aria-checked")).toBe("false");

    act(() => switchIn("general.trustedWorkspace").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("disables workspace-scoped controls without an open workspace", () => {
    render({ env: { hasWorkspace: false, workspaceRoot: null } });

    expect(switchIn("general.autoSave").disabled).toBe(true);
    expect(switchIn("general.trustedWorkspace").disabled).toBe(true);
    expect(chip("Cursor position").disabled).toBe(true);
    expect(queryIn<HTMLInputElement>("general.workspaceRoot", "input").value).toBe(
      "No workspace open",
    );
    expect(queryIn<HTMLSelectElement>("general.backgroundRuntimePolicy", "select").disabled).toBe(
      false,
    );
  });

  interface RenderOptions {
    readonly appSettings?: AppSettings;
    readonly env?: Partial<SettingsEnvironment>;
    readonly trusted?: boolean;
    readonly workspaceSettings?: WorkspaceSettings;
  }

  function render(options: RenderOptions): ReturnType<typeof vi.fn> {
    const onSave = vi.fn();

    act(() =>
      root.render(
        <GeneralHarness
          appSettings={options.appSettings ?? defaultAppSettings()}
          env={{ ...environment(), ...options.env }}
          onSave={onSave}
          trusted={options.trusted ?? true}
          workspaceSettings={options.workspaceSettings ?? defaultWorkspaceSettings()}
        />,
      ),
    );

    return onSave;
  }

  function rowElement(rowId: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-settings-row="${rowId}"]`);

    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function queryIn<T extends Element>(rowId: string, selector: string): T {
    const element = rowElement(rowId).querySelector<T>(selector);

    expect(element).not.toBeNull();
    return element as T;
  }

  function switchIn(rowId: string): HTMLButtonElement {
    return queryIn<HTMLButtonElement>(rowId, '[role="switch"]');
  }

  function chip(label: string): HTMLButtonElement {
    const match = [
      ...rowElement("general.statusBar").querySelectorAll<HTMLButtonElement>(".settings-chip"),
    ].find((candidate) => candidate.textContent === label);

    expect(match).toBeDefined();
    return match as HTMLButtonElement;
  }
});

function changeInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

interface GeneralHarnessProps {
  readonly appSettings: AppSettings;
  readonly env: SettingsEnvironment;
  readonly trusted: boolean;
  readonly workspaceSettings: WorkspaceSettings;
  onSave(input: SettingsSaveInput): void;
}

function GeneralHarness({
  appSettings,
  env,
  onSave,
  trusted,
  workspaceSettings,
}: GeneralHarnessProps) {
  const [draftAppSettings, setDraftAppSettings] = useState(appSettings);
  const [draftWorkspaceSettings, setDraftWorkspaceSettings] = useState(workspaceSettings);
  const [draftTrusted, setDraftTrusted] = useState(trusted);
  const appSettingsRef = useRef(appSettings);
  const workspaceSettingsRef = useRef(workspaceSettings);
  const trustedRef = useRef(trusted);

  const save = (input: Partial<SettingsSaveInput>): void => {
    onSave({
      appSettings: input.appSettings ?? appSettingsRef.current,
      trusted: env.hasWorkspace ? (input.trusted ?? trustedRef.current) : null,
      workspaceSettings: input.workspaceSettings ?? workspaceSettingsRef.current,
    });
  };

  const actions: SettingsDraftActions = {
    publishAppSettings: (settings) => {
      appSettingsRef.current = settings;
      setDraftAppSettings(settings);
    },
    save,
    updateAppSettings: (settings) => {
      appSettingsRef.current = settings;
      setDraftAppSettings(settings);
      save({ appSettings: settings });
    },
    updateIgnorePatternsText: () => undefined,
    updateTrusted: (next) => {
      trustedRef.current = next;
      setDraftTrusted(next);
      save({ trusted: next });
    },
    updateWorkspaceSettings: (settings) => {
      workspaceSettingsRef.current = settings;
      setDraftWorkspaceSettings(settings);
      save({ workspaceSettings: settings });
    },
  };

  return (
    <GeneralSettingsPage
      actions={actions}
      draft={{
        appSettings: draftAppSettings,
        ignorePatternsText: "",
        trusted: draftTrusted,
        workspaceSettings: draftWorkspaceSettings,
      }}
      env={env}
    />
  );
}

function environment(): SettingsEnvironment {
  return {
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
}
