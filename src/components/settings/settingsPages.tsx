import { AgentsSettingsPage } from "./pages/AgentsSettingsPage";
import { EnvironmentsSettingsPage } from "./pages/EnvironmentsSettingsPage";
import { AppearanceSettingsPage } from "./pages/AppearanceSettingsPage";
import { GeneralSettingsPage } from "./pages/GeneralSettingsPage";
import { IndexLanguagesSettingsPage } from "./pages/IndexLanguagesSettingsPage";
import { KeybindingsSettingsPage } from "./pages/KeybindingsSettingsPage";
import { PhpSettingsPage } from "./pages/PhpSettingsPage";
import { SnippetsSettingsPage } from "./pages/SnippetsSettingsPage";
import type { SettingsPageProps } from "./settingsPageProps";
import type { SettingsSectionId } from "./settingsRegistry";

export interface SettingsPageHostProps extends SettingsPageProps {
  readonly section: SettingsSectionId;
}

export function SettingsPageHost({ section, ...props }: SettingsPageHostProps) {
  switch (section) {
    case "general":
      return <GeneralSettingsPage {...props} />;
    case "appearance":
      return <AppearanceSettingsPage {...props} />;
    case "agents":
      return <AgentsSettingsPage {...props} />;
    case "environments":
      return <EnvironmentsSettingsPage />;
    case "keymap":
      return <KeybindingsSettingsPage {...props} />;
    case "index":
      return <IndexLanguagesSettingsPage {...props} />;
    case "php":
      return <PhpSettingsPage {...props} />;
    case "snippets":
      return <SnippetsSettingsPage {...props} />;
    default:
      return section satisfies never;
  }
}
