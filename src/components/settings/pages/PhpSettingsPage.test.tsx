// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type WorkspaceSettings,
} from "../../../domain/settings";
import type { PhpToolAvailability, WorkspaceDescriptor } from "../../../domain/workspace";
import type {
  SettingsDraftActions,
  SettingsEnvironment,
  SettingsSaveInput,
} from "../settingsPageProps";
import { PhpSettingsPage } from "./PhpSettingsPage";

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

const phpTools: PhpToolAvailability = {
  phpactor: { executable: "phpactor", path: "/managed/phpactor", source: "managed" },
  intelephense: {
    executable: "intelephense",
    path: "/workspace/node_modules/.bin/intelephense",
    source: "workspaceNodeModulesBin",
  },
};

const descriptor: WorkspaceDescriptor = {
  rootPath: "/workspace",
  javaScriptTypeScript: null,
  php: {
    classmapRoots: [],
    hasComposer: true,
    packageName: "acme/app",
    packages: [],
    phpPlatformVersion: "8.3",
    phpVersionConstraint: "^8.2",
    psr4Roots: [],
  },
};

interface HarnessProps {
  readonly env: SettingsEnvironment;
  readonly workspaceSettings: WorkspaceSettings;
  onSave(input: SettingsSaveInput): void;
}

function Harness({ env, onSave, workspaceSettings }: HarnessProps) {
  const [settings, setSettings] = useState(workspaceSettings);
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
    updateIgnorePatternsText: () => undefined,
    updateTrusted: () => undefined,
    updateWorkspaceSettings: (next) => {
      settingsRef.current = next;
      setSettings(next);
      onSave({ appSettings, trusted: true, workspaceSettings: next });
    },
  };

  return (
    <PhpSettingsPage
      actions={actions}
      draft={{
        appSettings,
        ignorePatternsText: "",
        trusted: true,
        workspaceSettings: settings,
      }}
      env={env}
    />
  );
}

describe("PhpSettingsPage", () => {
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

  it("persists the PHP backend preference", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await choose(selectIn("php.backend"), "intelephense");

    expect(lastWorkspaceSettings(onSave).phpBackend).toBe("intelephense");
  });

  it("edits and normalizes the PHPStan binary path", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await type(inputIn("php.phpstanPath"), " /tools/phpstan ");

    expect(lastWorkspaceSettings(onSave).phpstanPath).toBe("/tools/phpstan");
  });

  it("clears a tool path back to auto when emptied", async () => {
    const onSave = vi.fn();

    await render({ phpactorPath: "/tools/phpactor" }, onSave);

    await type(inputIn("php.phpactorPath"), "   ");

    expect(lastWorkspaceSettings(onSave).phpactorPath).toBeNull();
  });

  it("persists the PHP language level override", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await type(inputIn("php.versionOverride"), "8.2");

    expect(lastWorkspaceSettings(onSave).phpVersionOverride).toBe("8.2");
  });

  it("persists the PHPStan analyse-on-save and inlay hint switches", async () => {
    const onSave = vi.fn();

    await render({}, onSave);

    await click(switchIn("php.phpstanAnalyseOnSave"));
    expect(lastWorkspaceSettings(onSave).phpstanAnalyseOnSave).toBe(true);

    await click(switchIn("php.inlayHints"));
    expect(lastWorkspaceSettings(onSave).phpInlayHints).toBe(false);
  });

  it("reports detected tools and the effective PHP level", async () => {
    await render({}, undefined, { phpTools, workspaceDescriptor: descriptor });

    expect(rowFor("php.composerPhpVersion").textContent).toContain("8.3");
    expect(rowFor("php.effectivePhpLevel").textContent).toContain("8.3");
    expect(rowFor("php.detectedPhpEngine").textContent).toContain("/managed/phpactor");
    expect(rowFor("php.detectedIntelephense").textContent).toContain("intelephense");
    expect(inputIn("php.phpactorPath").placeholder).toBe("/managed/phpactor");
  });

  it("reports missing tools and levels truthfully", async () => {
    await render({});

    expect(rowFor("php.composerPhpVersion").textContent).toContain("Not declared");
    expect(rowFor("php.effectivePhpLevel").textContent).toContain("Auto");
    expect(rowFor("php.detectedPhpEngine").textContent).toContain("Not detected");
    expect(rowFor("php.detectedIntelephense").textContent).toContain("Not detected");
  });

  it("prefers the override over the detected composer level", async () => {
    await render({ phpVersionOverride: "8.1" }, undefined, { workspaceDescriptor: descriptor });

    expect(rowFor("php.effectivePhpLevel").textContent).toContain("8.1");
  });

  it("disables every PHP control without an open workspace", async () => {
    await render({}, undefined, { hasWorkspace: false, workspaceRoot: null });

    expect(selectIn("php.backend").disabled).toBe(true);
    expect(inputIn("php.phpstanPath").disabled).toBe(true);
    expect(switchIn("php.inlayHints").disabled).toBe(true);
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

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
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
