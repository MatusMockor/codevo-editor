import { vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../../domain/settings";
import type { SettingsEnvironment, SettingsPageProps } from "../settingsPageProps";

export function settingsPagePropsFixture(
  overrides: {
    readonly env?: Partial<SettingsEnvironment>;
  } = {},
): SettingsPageProps {
  return {
    actions: {
      publishAppSettings: vi.fn(),
      save: vi.fn(),
      updateAppSettings: vi.fn(),
      updateIgnorePatternsText: vi.fn(),
      updateTrusted: vi.fn(),
      updateWorkspaceSettings: vi.fn(),
    },
    draft: {
      appSettings: defaultAppSettings(),
      ignorePatternsText: "",
      trusted: false,
      workspaceSettings: defaultWorkspaceSettings(),
    },
    env: {
      agentActivity: null,
      agentProjects: [],
      appUpdater: null,
      gitDetectedRepositoryMappings: [],
      hasWorkspace: false,
      onCopyInstallCommand: vi.fn(),
      onOpenJavaScriptTypeScriptServiceLog: vi.fn(async () => undefined),
      onOpenNodeLaunchConfigurations: vi.fn(),
      onRestartJavaScriptTypeScriptService: vi.fn(async () => undefined),
      phpTools: null,
      providerManagement: null,
      providerSignIn: null,
      systemFontGateway: { listMonospaceFontFamilies: async () => [] },
      workspaceDescriptor: null,
      workspaceRoot: null,
      ...overrides.env,
    },
  };
}
