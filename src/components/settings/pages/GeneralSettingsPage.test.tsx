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
import {
  DEFAULT_AGENT_THREAD_FONT_SIZE,
  MAX_AGENT_THREAD_FONT_SIZE,
} from "../../../domain/agentSettings";
import { DEFAULT_APPEARANCE, type ColorSchemePreference } from "../../../domain/appearance";
import { surfaceColor } from "../../../domain/appearancePalettes";
import type { SystemFontGateway } from "../../../domain/systemFonts";
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
    vi.unstubAllGlobals();
  });

  it("autosaves the terminal shell integration opt-in", async () => {
    const onSave = await render({});

    act(() => switchIn("general.terminalShellIntegration").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), terminalShellIntegrationEnabled: true },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("autosaves setting changes without a Save button", async () => {
    const onSave = await render({});

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

  it("keeps Auto save enabled by default and persists disabling it", async () => {
    const onSave = await render({});

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

  it("keeps Format on save disabled by default and persists enabling it", async () => {
    const onSave = await render({});

    expect(switchIn("general.formatOnSave").getAttribute("aria-checked")).toBe("false");

    act(() => switchIn("general.formatOnSave").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), formatOnSave: true },
    });
  });

  it("keeps Format on paste disabled by default and persists enabling it", async () => {
    const onSave = await render({});

    act(() => switchIn("general.formatOnPaste").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), formatOnPaste: true },
    });
  });

  it("keeps Optimize imports on save disabled by default and persists enabling it", async () => {
    const onSave = await render({});

    act(() => switchIn("general.optimizeImportsOnSave").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: { ...defaultWorkspaceSettings(), optimizeImportsOnSave: true },
    });
  });

  it("persists default indentation settings", async () => {
    const onSave = await render({});
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

  it("clamps the tab size stepper to the workspace bounds", async () => {
    const onSave = await render({
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

  it("offers only the header readouts the editor renders", async () => {
    const onSave = await render({});
    const labels = [
      ...rowElement("general.statusBar").querySelectorAll<HTMLButtonElement>(".settings-chip"),
    ].map((candidate) => candidate.textContent);

    expect(labels).toEqual(["Index", "IDE engine", "Cursor position"]);

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

  it("persists the intelligence mode from the segmented control", async () => {
    const onSave = await render({});
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

  it("persists the background runtime policy", async () => {
    const onSave = await render({});
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

  it("persists workspace trust separately from the settings drafts", async () => {
    const onSave = await render({ trusted: false });

    expect(switchIn("general.trustedWorkspace").getAttribute("aria-checked")).toBe("false");

    act(() => switchIn("general.trustedWorkspace").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("disables workspace-scoped controls without an open workspace", async () => {
    await render({ env: { hasWorkspace: false, workspaceRoot: null } });

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

  it("renders the mockup sections in order", async () => {
    await render({});

    expect(
      [...host.querySelectorAll(".settings-section__title")].map((node) => node.textContent),
    ).toEqual(["Theme", "Text & editor", "Updates", "Workspace", "Editing", "Editor header items"]);
  });

  it("switches the appearance mode from the Theme header", async () => {
    const onSave = await render({});
    const light = radioIn("appearance.colorScheme", "Light");

    expect(radioIn("appearance.colorScheme", "System").getAttribute("aria-checked")).toBe("true");

    act(() => light.click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        appearance: { ...DEFAULT_APPEARANCE, colorScheme: "light" },
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("selects a palette card from the six-palette radiogroup", async () => {
    const onSave = await render({});
    const group = host.querySelector('[role="radiogroup"][aria-label="Palette"]');

    expect(group?.querySelectorAll('[role="radio"]').length).toBe(6);

    act(() => paletteCard("Ink · Mint palette").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        appearance: { ...DEFAULT_APPEARANCE, palette: "ink-mint" },
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("moves the palette selection with the arrow, Home and End keys", async () => {
    const onSave = await render({});
    const press = (key: string): void => {
      act(() => {
        paletteCards()[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      });
    };
    const savedPalette = (): string => {
      const calls = onSave.mock.calls;
      const last = calls[calls.length - 1]?.[0] as SettingsSaveInput | undefined;

      return last?.appSettings.appearance.palette ?? "";
    };

    press("ArrowRight");
    expect(savedPalette()).toBe("slate-blue");

    press("End");
    expect(savedPalette()).toBe("carbon-lime");

    press("ArrowRight");
    expect(savedPalette()).toBe("graphite-teal");

    press("Home");
    expect(savedPalette()).toBe("graphite-teal");
  });

  it.each([
    { preference: "light", prefersLight: false, resolved: "light" },
    { preference: "dark", prefersLight: true, resolved: "dark" },
    { preference: "system", prefersLight: true, resolved: "light" },
    { preference: "system", prefersLight: false, resolved: "dark" },
  ] as const)(
    "previews the palettes in the $resolved scheme for $preference on a light OS: $prefersLight",
    async ({ preference, prefersLight, resolved }) => {
      stubSystemScheme(prefersLight);
      await render({ appSettings: appearanceSettings(preference) });

      expect(paletteCards()[0]?.style.getPropertyValue("--settings-wire-canvas")).toBe(
        surfaceColor("graphite-teal", resolved, "canvas"),
      );
    },
  );

  it("shows a single Updates section without an update track row", async () => {
    await render({});

    expect(host.querySelector('[data-settings-row="general.appUpdates"]')).not.toBeNull();
    expect(host.querySelector('[data-settings-row="general.updateChannel"]')).toBeNull();
    expect(host.textContent).not.toContain("Update track");
    expect(host.querySelector('[role="radiogroup"][aria-label="Update track"]')).toBeNull();
  });

  it("toggles the sidebar attention item in editor header items", async () => {
    const onSave = await render({});
    const attention = defaultWorkspaceSettings().statusBar.agentAttention;

    expect(switchIn("general.threadAttention").getAttribute("aria-checked")).toBe(`${attention}`);

    act(() => switchIn("general.threadAttention").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: defaultAppSettings(),
      trusted: true,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        statusBar: { ...defaultWorkspaceSettings().statusBar, agentAttention: !attention },
      },
    });
  });

  it("disables the attention item without an open workspace", async () => {
    await render({ env: { hasWorkspace: false, workspaceRoot: null } });

    expect(switchIn("general.threadAttention").disabled).toBe(true);
  });

  it("loads monospace font families from the system font gateway", async () => {
    const systemFontGateway: SystemFontGateway = {
      listMonospaceFontFamilies: vi.fn(async () => ["Iosevka", "Fira Code", "Iosevka"]),
    };
    await render({ env: { systemFontGateway } });

    expect(systemFontGateway.listMonospaceFontFamilies).toHaveBeenCalled();
    expectFontFamilyOptions(["Fira Code", "Iosevka", defaultAppSettings().editorFontFamily]);
    expect(switchIn("appearance.editorFontLigatures").getAttribute("aria-checked")).toBe("false");
    expect(switchIn("appearance.minimap").getAttribute("aria-checked")).toBe("false");
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
    await render({ env: { systemFontGateway } });

    await act(async () => {
      button("Refresh list").click();
      await Promise.resolve();
    });

    expectFontFamilyOptions(["Iosevka", defaultAppSettings().editorFontFamily]);

    await act(async () => {
      resolveInitialFonts(["Fira Code"]);
      await Promise.resolve();
    });

    expectFontFamilyOptions(["Iosevka", defaultAppSettings().editorFontFamily]);
  });

  it("persists editor font changes from the Text & editor section", async () => {
    const onSave = await render({
      env: {
        systemFontGateway: { listMonospaceFontFamilies: vi.fn(async () => ["Fira Code"]) },
      },
    });
    const fontFamily = () => queryIn<HTMLSelectElement>("appearance.editorFontFamily", "select");

    act(() => {
      fontFamily().value = "Fira Code";
      fontFamily().dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), editorFontFamily: "Fira Code, monospace" },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });

    act(() => stepperButton("appearance.editorFontSize", "Increase Editor font size").click());

    const fontSize = defaultAppSettings().editorFontSize + 1;
    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        editorFontFamily: "Fira Code, monospace",
        editorFontSize: fontSize,
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });

    act(() => switchIn("appearance.editorFontLigatures").click());
    act(() => switchIn("appearance.minimap").click());
    act(() => switchIn("appearance.wordWrap").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        editorFontFamily: "Fira Code, monospace",
        editorFontLigatures: true,
        editorFontSize: fontSize,
        minimapEnabled: true,
        wordWrapEnabled: true,
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("persists the syntax theme while preserving workspace settings and trust", async () => {
    const workspaceSettings: WorkspaceSettings = {
      ...defaultWorkspaceSettings(),
      defaultTabSize: 2,
      statusBar: { ...defaultWorkspaceSettings().statusBar, index: false },
    };
    const onSave = await render({ trusted: false, workspaceSettings });
    const syntax = () => queryIn<HTMLSelectElement>("appearance.syntaxTheme", "select");

    expect(syntax().value).toBe("matchPalette");

    act(() => {
      syntax().value = "oneDarkPro";
      syntax().dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        appearance: { ...DEFAULT_APPEARANCE, syntaxTheme: "oneDarkPro" },
      },
      trusted: false,
      workspaceSettings,
    });
  });

  it("steps the thread text size and clamps it at the maximum", async () => {
    const onSave = await render({});
    const value = () =>
      queryIn<HTMLElement>("appearance.agentThreadFontSize", '[role="spinbutton"]');

    expect(value().getAttribute("aria-valuenow")).toBe(`${DEFAULT_AGENT_THREAD_FONT_SIZE}`);

    act(() => stepperButton("appearance.agentThreadFontSize", "Increase Thread text size").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        agentThreadFontSize: DEFAULT_AGENT_THREAD_FONT_SIZE + 1,
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });

    act(() => {
      value().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), agentThreadFontSize: MAX_AGENT_THREAD_FONT_SIZE },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
    expect(
      stepperButton("appearance.agentThreadFontSize", "Increase Thread text size").disabled,
    ).toBe(true);
  });

  interface RenderOptions {
    readonly appSettings?: AppSettings;
    readonly env?: Partial<SettingsEnvironment>;
    readonly trusted?: boolean;
    readonly workspaceSettings?: WorkspaceSettings;
  }

  async function render(options: RenderOptions): Promise<ReturnType<typeof vi.fn>> {
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <GeneralHarness
          appSettings={options.appSettings ?? defaultAppSettings()}
          env={{ ...environment(), ...options.env }}
          onSave={onSave}
          trusted={options.trusted ?? true}
          workspaceSettings={options.workspaceSettings ?? defaultWorkspaceSettings()}
        />,
      );
      await Promise.resolve();
    });

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

  function radioIn(rowId: string, label: string): HTMLButtonElement {
    const match = [...rowElement(rowId).querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (candidate) => candidate.textContent === label,
    );

    expect(match).toBeDefined();
    return match as HTMLButtonElement;
  }

  function paletteCards(): HTMLButtonElement[] {
    return [
      ...rowElement("appearance.palette").querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
  }

  function paletteCard(label: string): HTMLButtonElement {
    const match = paletteCards().find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );

    expect(match).toBeDefined();
    return match as HTMLButtonElement;
  }

  function stepperButton(rowId: string, label: string): HTMLButtonElement {
    return queryIn<HTMLButtonElement>(rowId, `button[aria-label="${label}"]`);
  }

  function button(label: string): HTMLButtonElement {
    const match = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    expect(match).toBeDefined();
    return match as HTMLButtonElement;
  }

  function expectFontFamilyOptions(expected: ReadonlyArray<string>): void {
    const options = [
      ...queryIn<HTMLSelectElement>("appearance.editorFontFamily", "select").options,
    ].map((option) => option.value);

    expect(options).toEqual([...expected].sort((left, right) => left.localeCompare(right)));
  }

  function appearanceSettings(colorScheme: ColorSchemePreference): AppSettings {
    return { ...defaultAppSettings(), appearance: { ...DEFAULT_APPEARANCE, colorScheme } };
  }

  function stubSystemScheme(prefersLight: boolean): void {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        addEventListener: vi.fn(),
        matches: prefersLight && query === "(prefers-color-scheme: light)",
        media: query,
        removeEventListener: vi.fn(),
      })),
    );
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
