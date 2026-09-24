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
  MIN_AGENT_THREAD_FONT_SIZE,
} from "../../../domain/agentSettings";
import { DEFAULT_APPEARANCE, type ColorSchemePreference } from "../../../domain/appearance";
import { surfaceColor } from "../../../domain/appearancePalettes";
import type { SystemFontGateway } from "../../../domain/systemFonts";
import type {
  SettingsDraftActions,
  SettingsEnvironment,
  SettingsSaveInput,
} from "../settingsPageProps";
import { AppearanceSettingsPage } from "./AppearanceSettingsPage";

describe("AppearanceSettingsPage", () => {
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

  it("loads monospace font families from the system font gateway", async () => {
    const systemFontGateway: SystemFontGateway = {
      listMonospaceFontFamilies: vi.fn(async () => ["Iosevka", "Fira Code", "Iosevka"]),
    };
    await render({ systemFontGateway });

    expect(queryIn<HTMLSelectElement>("appearance.syntaxTheme", "select")).not.toBeNull();
    expect(systemFontGateway.listMonospaceFontFamilies).toHaveBeenCalled();
    expectFontFamilyOptions(["Fira Code", "Iosevka", defaultAppSettings().editorFontFamily]);
    expect(queryIn<HTMLInputElement>("appearance.editorFontSize", "input").type).toBe("number");
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
    await render({ systemFontGateway });

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

  it("persists editor font appearance changes", async () => {
    const onSave = await render({
      systemFontGateway: { listMonospaceFontFamilies: vi.fn(async () => ["Fira Code"]) },
    });
    const fontFamily = () => queryIn<HTMLSelectElement>("appearance.editorFontFamily", "select");

    expectFontFamilyOptions(["Fira Code", defaultAppSettings().editorFontFamily]);

    act(() => {
      fontFamily().value = "Fira Code";
      fontFamily().dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), editorFontFamily: "Fira Code, monospace" },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });

    const fontSize = () => queryIn<HTMLInputElement>("appearance.editorFontSize", "input");

    act(() => changeInputValue(fontSize(), "16"));

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        editorFontFamily: "Fira Code, monospace",
        editorFontSize: 16,
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });

    act(() => switchIn("appearance.editorFontLigatures").click());

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

    act(() => switchIn("appearance.minimap").click());
    act(() => switchIn("appearance.wordWrap").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        editorFontFamily: "Fira Code, monospace",
        editorFontLigatures: true,
        editorFontSize: 16,
        minimapEnabled: true,
        wordWrapEnabled: true,
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("clamps the font size stepper to the supported range", async () => {
    const onSave = await render({});
    const stepper = (label: string) =>
      queryIn<HTMLButtonElement>("appearance.editorFontSize", `button[aria-label="${label}"]`);

    act(() => stepper("Increase").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        editorFontSize: defaultAppSettings().editorFontSize + 1,
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("persists syntax theme changes while preserving workspace settings and trust", async () => {
    const workspaceSettings: WorkspaceSettings = {
      ...defaultWorkspaceSettings(),
      defaultTabSize: 2,
      revealActiveFileInTree: false,
      statusBar: { ...defaultWorkspaceSettings().statusBar, message: false },
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

  it("selects a palette from the swatches", async () => {
    const onSave = await render({});
    const swatch = [
      ...rowElement("appearance.palette").querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ].find((candidate) => candidate.getAttribute("aria-label") === "Ink · Mint");

    expect(swatch).toBeDefined();
    act(() => (swatch as HTMLButtonElement).click());

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
    const swatches = () => [
      ...rowElement("appearance.palette").querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
    const press = (key: string): void => {
      act(() => {
        swatches()[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      });
    };
    const savedPalette = (): string => {
      const calls = onSave.mock.calls;
      const last = calls[calls.length - 1]?.[0] as {
        appSettings: { appearance: { palette: string } };
      };

      return last.appSettings.appearance.palette;
    };

    press("ArrowRight");
    expect(savedPalette()).toBe("slate-blue");

    press("End");
    expect(savedPalette()).toBe("carbon-lime");

    press("ArrowRight");
    expect(savedPalette()).toBe("graphite-teal");

    press("ArrowLeft");
    expect(savedPalette()).toBe("carbon-lime");

    press("Home");
    expect(savedPalette()).toBe("graphite-teal");
  });

  it("persists the agent thread text size and clamps it to the supported range", async () => {
    const onSave = await render({});
    const field = () => queryIn<HTMLInputElement>("appearance.agentThreadFontSize", "input");

    expect(field().type).toBe("number");
    expect(field().value).toBe(`${DEFAULT_AGENT_THREAD_FONT_SIZE}`);
    expect(field().min).toBe(`${MIN_AGENT_THREAD_FONT_SIZE}`);
    expect(field().max).toBe(`${MAX_AGENT_THREAD_FONT_SIZE}`);

    act(() => changeInputValue(field(), "18"));

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), agentThreadFontSize: 18 },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });

    act(() => changeInputValue(field(), "400"));

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: { ...defaultAppSettings(), agentThreadFontSize: MAX_AGENT_THREAD_FONT_SIZE },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("persists the colour scheme from the segmented control", async () => {
    const onSave = await render({});
    const option = (label: string): HTMLButtonElement => {
      const match = [
        ...rowElement("appearance.colorScheme").querySelectorAll<HTMLButtonElement>(
          '[role="radio"]',
        ),
      ].find((candidate) => candidate.textContent === label);

      expect(match).toBeDefined();
      return match as HTMLButtonElement;
    };

    expect(option("System").getAttribute("aria-checked")).toBe("true");

    act(() => option("Dark").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        appearance: { ...DEFAULT_APPEARANCE, colorScheme: "dark" },
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
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

      expect(firstSwatchBackground()).toBe(
        cssBackground(surfaceColor("graphite-teal", resolved, "canvas")),
      );
    },
  );

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

  function firstSwatchBackground(): string {
    return (
      rowElement("appearance.palette").querySelector<HTMLButtonElement>('[role="radio"]')?.style
        .background ?? ""
    );
  }

  function cssBackground(color: string): string {
    const probe = document.createElement("span");
    probe.style.background = color;
    return probe.style.background;
  }

  interface RenderOptions {
    readonly appSettings?: AppSettings;
    readonly systemFontGateway?: SystemFontGateway;
    readonly trusted?: boolean;
    readonly workspaceSettings?: WorkspaceSettings;
  }

  async function render(options: RenderOptions): Promise<ReturnType<typeof vi.fn>> {
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <AppearanceHarness
          appSettings={options.appSettings ?? defaultAppSettings()}
          env={{
            ...environment(),
            systemFontGateway: options.systemFontGateway ?? environment().systemFontGateway,
          }}
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
});

function changeInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

interface AppearanceHarnessProps {
  readonly appSettings: AppSettings;
  readonly env: SettingsEnvironment;
  readonly trusted: boolean;
  readonly workspaceSettings: WorkspaceSettings;
  onSave(input: SettingsSaveInput): void;
}

function AppearanceHarness({
  appSettings,
  env,
  onSave,
  trusted,
  workspaceSettings,
}: AppearanceHarnessProps) {
  const [draftAppSettings, setDraftAppSettings] = useState(appSettings);
  const appSettingsRef = useRef(appSettings);

  const save = (input: Partial<SettingsSaveInput>): void => {
    onSave({
      appSettings: input.appSettings ?? appSettingsRef.current,
      trusted: env.hasWorkspace ? trusted : null,
      workspaceSettings,
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
    updateTrusted: () => undefined,
    updateWorkspaceSettings: () => undefined,
  };

  return (
    <AppearanceSettingsPage
      actions={actions}
      draft={{
        appSettings: draftAppSettings,
        ignorePatternsText: "",
        trusted,
        workspaceSettings,
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
