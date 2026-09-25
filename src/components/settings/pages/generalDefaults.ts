import { defaultAppSettings, type AppSettings } from "../../../domain/settings";

export function restoreGeneralAppDefaults(current: AppSettings): AppSettings {
  const defaults = defaultAppSettings();
  return {
    ...current,
    appearance: defaults.appearance,
    agentThreadFontSize: defaults.agentThreadFontSize,
    editorFontFamily: defaults.editorFontFamily,
    editorFontLigatures: defaults.editorFontLigatures,
    editorFontSize: defaults.editorFontSize,
    minimapEnabled: defaults.minimapEnabled,
    runtimePolicy: defaults.runtimePolicy,
    terminalShellIntegrationEnabled: defaults.terminalShellIntegrationEnabled,
    wordWrapEnabled: defaults.wordWrapEnabled,
  };
}
