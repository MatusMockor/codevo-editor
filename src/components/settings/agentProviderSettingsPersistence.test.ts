import { describe, expect, it } from "vitest";
import { MAX_AGENT_MODEL_FAVORITES, type AgentModelFavoriteKey } from "../../domain/agentSettings";
import { defaultAppSettings } from "../../domain/settings";
import { withToggledModelFavorite } from "./agentProviderSettingsPersistence";

describe("withToggledModelFavorite", () => {
  it("toggles one favorite and bumps the revision", () => {
    const base = {
      ...defaultAppSettings(),
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 4,
    };
    const added = withToggledModelFavorite(base, "claudeCode/claude-opus-5-5");
    expect(added?.agentModelFavoriteKeys).toEqual(["claudeCode/claude-opus-5-5"]);
    expect(added?.agentModelFavoritesRevision).toBe(5);
    const removed =
      added === null ? null : withToggledModelFavorite(added, "claudeCode/claude-opus-5-5");
    expect(removed?.agentModelFavoriteKeys).toEqual([]);
    expect(removed?.agentModelFavoritesRevision).toBe(6);
  });

  it("refuses to add beyond the favorites limit but still allows removal", () => {
    const keys: ReadonlyArray<AgentModelFavoriteKey> = Array.from(
      { length: MAX_AGENT_MODEL_FAVORITES },
      (_, index) => (index === 0 ? "codex/gpt-5.5" : "codex/gpt-5.4"),
    );
    const full = {
      ...defaultAppSettings(),
      agentModelFavoriteKeys: keys,
      agentModelFavoritesRevision: 1,
    };
    expect(withToggledModelFavorite(full, "claudeCode/claude-opus-5-5")).toBeNull();
    const shrunk = withToggledModelFavorite(full, "codex/gpt-5.5");
    expect(shrunk?.agentModelFavoriteKeys).toHaveLength(MAX_AGENT_MODEL_FAVORITES - 1);
    expect(shrunk?.agentModelFavoritesRevision).toBe(2);
  });

  it("refuses when the revision cannot advance", () => {
    const exhausted = {
      ...defaultAppSettings(),
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: Number.MAX_SAFE_INTEGER,
    };
    expect(withToggledModelFavorite(exhausted, "claudeCode/claude-opus-5-5")).toBeNull();
  });
});
