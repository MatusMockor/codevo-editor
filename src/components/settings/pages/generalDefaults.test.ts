import { describe, expect, it } from "vitest";
import type { AgentModelFavoriteKey } from "../../../domain/agentSettings";
import { defaultAppSettings, type AppSettings } from "../../../domain/settings";
import { restoreGeneralAppDefaults } from "./generalDefaults";

describe("restoreGeneralAppDefaults", () => {
  it("resets only the General page app settings", () => {
    const favorite: AgentModelFavoriteKey = "claudeCode/claude-opus-5-5";
    const current: AppSettings = {
      ...defaultAppSettings(),
      agentThreadFontSize: 19,
      appUpdateChannel: "stable",
      agentModelFavoriteKeys: [favorite],
      editorFontFamily: "Menlo",
      editorFontLigatures: true,
      editorFontSize: 30,
      minimapEnabled: true,
      terminalShellIntegrationEnabled: true,
      wordWrapEnabled: true,
    };

    const restored = restoreGeneralAppDefaults(current);
    const defaults = defaultAppSettings();

    expect(restored.editorFontSize).toBe(defaults.editorFontSize);
    expect(restored.editorFontFamily).toBe(defaults.editorFontFamily);
    expect(restored.editorFontLigatures).toBe(defaults.editorFontLigatures);
    expect(restored.agentThreadFontSize).toBe(defaults.agentThreadFontSize);
    expect(restored.minimapEnabled).toBe(false);
    expect(restored.wordWrapEnabled).toBe(false);
    expect(restored.terminalShellIntegrationEnabled).toBe(false);
    expect(restored.appUpdateChannel).toBe("stable");
    expect(restored.agentModelFavoriteKeys).toEqual([favorite]);
  });
});
