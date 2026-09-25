import { AgentsSettingsPage } from "./pages/AgentsSettingsPage";
import { ArchiveSettingsPage } from "./pages/ArchiveSettingsPage";
import { EnvironmentsSettingsPage } from "./pages/EnvironmentsSettingsPage";
import { GeneralSettingsPage } from "./pages/GeneralSettingsPage";
import { IndexLanguagesSettingsPage } from "./pages/IndexLanguagesSettingsPage";
import { KeybindingsSettingsPage } from "./pages/KeybindingsSettingsPage";
import { PhpSettingsPage } from "./pages/PhpSettingsPage";
import { SnippetsSettingsPage } from "./pages/SnippetsSettingsPage";
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
    case "keymap":
      return <KeybindingsSettingsPage {...props} />;
    case "index":
      return <IndexLanguagesSettingsPage {...props} />;
    case "php":
      return <PhpSettingsPage {...props} />;
    case "snippets":
      return <SnippetsSettingsPage {...props} />;
    case "usage":
      return <UsageSettingsPage {...props} />;
    case "archive":
      return <ArchiveSettingsPage {...props} />;
    default:
      return section satisfies never;
  }
}
