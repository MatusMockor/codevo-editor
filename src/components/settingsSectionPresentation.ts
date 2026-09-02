import type { SettingsSection } from "../domain/settings";
import { settingsDialogSections } from "./settingsDialogModel";

export function settingsSectionLabel(section: SettingsSection): string {
  return settingsDialogSections.find((item) => item.id === section)?.label ?? "Settings";
}
