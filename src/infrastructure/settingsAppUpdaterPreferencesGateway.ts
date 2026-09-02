import type { AppUpdaterPreferencesGateway } from "../domain/appUpdater";
import type { SettingsGateway } from "../domain/settings";

export class SettingsAppUpdaterPreferencesGateway implements AppUpdaterPreferencesGateway {
  constructor(
    private readonly settingsGateway: Pick<SettingsGateway, "loadAppSettings" | "saveAppSettings">,
  ) {}

  async loadSkippedVersion(): Promise<string | null> {
    const settings = await this.settingsGateway.loadAppSettings();
    return settings.appUpdaterSkippedVersion;
  }
}
