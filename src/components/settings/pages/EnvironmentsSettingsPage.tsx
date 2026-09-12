import { Check, Monitor, Plus, Server } from "lucide-react";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import "./environmentsSettings.css";

export function EnvironmentsSettingsPage() {
  return (
    <SettingsSectionHeading title="Environments">
      <SettingsRow rowId="environments.local">
        <span className="settings-environments__default">
          <Monitor aria-hidden="true" size={15} />
          Default for new threads
          <Check aria-hidden="true" size={14} />
        </span>
      </SettingsRow>
      <SettingsRow layout="stacked" rowId="environments.servers">
        <div className="settings-environments__empty">
          <Server aria-hidden="true" className="settings-environments__icon" size={24} />
          <div className="settings-environments__copy">
            <p className="settings-environments__title">No servers connected</p>
            <p className="settings-environments__description">
              Server connections and remote execution are coming in a later update. Your threads
              currently run on this computer.
            </p>
          </div>
          <SettingsButton
            disabled
            onClick={() => undefined}
            title="Server connections are not available yet"
            variant="outline"
          >
            <Plus aria-hidden="true" size={14} />
            Add server
          </SettingsButton>
        </div>
      </SettingsRow>
    </SettingsSectionHeading>
  );
}
