import type { AgentRailWorkingSectionPreferencePort } from "../../application/agentRailWorkingSectionPreferencePort";
import { useAgentRailWorkingSection } from "../agentMode/useAgentRailWorkingSection";
import { SettingsRow } from "./primitives/SettingsRow";
import { SettingsSectionHeading } from "./primitives/SettingsSectionHeading";
import { SettingsSwitch } from "./primitives/SettingsSwitch";
import { settingsRowDescriptor } from "./settingsRegistry";

export const WORKING_SECTION_NOT_SAVED_NOTE =
  "Could not be saved on this device; it will reset when the app restarts.";

export interface AgentSidebarSettingsRowsProps {
  readonly workingSectionPreference: AgentRailWorkingSectionPreferencePort | null;
}

export function AgentSidebarSettingsRows({
  workingSectionPreference,
}: AgentSidebarSettingsRowsProps) {
  const { persistence, setWorkingSection, workingSection } =
    useAgentRailWorkingSection(workingSectionPreference);

  return (
    <SettingsSectionHeading title="Sidebar">
      <SettingsRow
        description={persistence === "sessionOnly" ? <NotSavedDescription /> : undefined}
        meta={<span className="settings-row__meta">Beta</span>}
        rowId="agents.workingSection"
      >
        <SettingsSwitch
          checked={workingSection === "on"}
          disabled={workingSectionPreference === null}
          onChange={(checked) => setWorkingSection(checked ? "on" : "off")}
        />
      </SettingsRow>
    </SettingsSectionHeading>
  );
}

function NotSavedDescription() {
  return (
    <>
      {settingsRowDescriptor("agents.workingSection").description}{" "}
      <span role="status">{WORKING_SECTION_NOT_SAVED_NOTE}</span>
    </>
  );
}
