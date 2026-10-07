import { RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import { AGENT_PROVIDERS } from "./agentProviderSettingsPersistence";
import { restoreGeneralAppDefaults } from "./pages/generalDefaults";
import { McpServersPageActions } from "./pages/McpServersSettingsPage";
import { UsagePageActions } from "./pages/UsageSettingsPage";
import type { SettingsPageProps } from "./settingsPageProps";
import type { SettingsSectionId } from "./settingsRegistry";

export interface SettingsPageActionsProps extends SettingsPageProps {
  readonly section: SettingsSectionId;
}

export function SettingsPageActions({ actions, draft, env, section }: SettingsPageActionsProps) {
  switch (section) {
    case "general":
      return (
        <Button
          icon={<RotateCcw aria-hidden="true" size={14} />}
          onClick={() => actions.updateAppSettings(restoreGeneralAppDefaults(draft.appSettings))}
          size="sm"
          variant="ghost"
        >
          Restore defaults
        </Button>
      );
    case "agents":
      return (
        <Button
          disabled={env.providerManagement === null}
          icon={<RefreshCw aria-hidden="true" size={14} />}
          onClick={() => {
            for (const provider of AGENT_PROVIDERS) void env.providerManagement?.refresh(provider);
          }}
          size="sm"
          variant="ghost"
        >
          Run CLI diagnostics
        </Button>
      );
    case "usage":
      return <UsagePageActions env={env} />;
    case "mcp":
      return <McpServersPageActions env={env} />;
    case "environments":
    case "keymap":
    case "index":
    case "snippets":
    case "archive":
    case "php":
      return null;
    default:
      return section satisfies never;
  }
}
