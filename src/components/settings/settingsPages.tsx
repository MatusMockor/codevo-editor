import { AgentsSettingsPage } from "./pages/AgentsSettingsPage";
import { ArchiveSettingsPage } from "./pages/ArchiveSettingsPage";
import { EnvironmentsSettingsPage } from "./pages/EnvironmentsSettingsPage";
import { GeneralSettingsPage } from "./pages/GeneralSettingsPage";
import { GitDirectoryMappingsRows } from "./pages/GitDirectoryMappingsRows";
import { KeybindingsSettingsPage } from "./pages/KeybindingsSettingsPage";
import { McpServersSettingsPage } from "./pages/McpServersSettingsPage";
import { UsageSettingsPage } from "./pages/UsageSettingsPage";
import type { SettingsPageProps } from "./settingsPageProps";
import type { SettingsSectionId } from "./settingsRegistry";

export interface SettingsPageHostProps extends SettingsPageProps {
  readonly section: SettingsSectionId;
}

export function SettingsPageHost({ section, ...props }: SettingsPageHostProps) {
  switch (section) {
    case "general":
      return <GeneralSettingsPage {...props} />;
    case "agents":
      return <AgentsSettingsPage {...props} />;
    case "environments":
      return <EnvironmentsSettingsPage projects={props.env.agentProjects} />;
    case "mcp":
      return <McpServersSettingsPage {...props} />;
    case "keymap":
      return <KeybindingsSettingsPage {...props} />;
    case "git":
      return <GitDirectoryMappingsRows {...props} />;
    case "usage":
      return <UsageSettingsPage {...props} />;
    case "archive":
      return <ArchiveSettingsPage {...props} />;
    default:
      return section satisfies never;
  }
}
