import type { SettingsSectionId } from "./settingsRegistry";

export const SETTINGS_PANEL_ID = "settings-page-panel";
export const SETTINGS_RESULTS_ID = "settings-search-results";

export function settingsSectionTabId(section: SettingsSectionId): string {
  return `settings-tab-${section}`;
}
