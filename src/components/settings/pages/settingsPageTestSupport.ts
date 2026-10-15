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
      updateTrusted: vi.fn(),
      updateWorkspaceSettings: vi.fn(),
    },
    draft: {
      appSettings: defaultAppSettings(),
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
      providerManagement: null,
      providerSignIn: null,
      systemFontGateway: { listMonospaceFontFamilies: async () => [] },
      workspaceRoot: null,
      ...overrides.env,
    },
  };
}
