import { defaultAppSettings, type AppSettings, type SettingsGateway } from "../../domain/settings";

type InitialAppearanceSource = Pick<SettingsGateway, "readInitialAppearance">;

export function initialAppSettings(settingsGateway: InitialAppearanceSource): AppSettings {
  const defaults = defaultAppSettings();
  if (settingsGateway.readInitialAppearance === undefined) return defaults;
  return { ...defaults, appearance: settingsGateway.readInitialAppearance() };
}

export function initialAppSettingsFrom(
  settingsGateway: InitialAppearanceSource,
): () => AppSettings {
  return () => initialAppSettings(settingsGateway);
}
